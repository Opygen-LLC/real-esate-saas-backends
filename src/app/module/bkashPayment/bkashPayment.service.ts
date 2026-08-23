import { randomUUID } from 'crypto'
import httpStatus from 'http-status'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { Billing } from '../billing/billing.model'
import { Organization } from '../organization/organization.model'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { SubscriptionPlanService } from '../subscriptionPlan/subscriptionPlan.service'
import { BkashPaymentClient } from './bkashPayment.client'
import { BkashGatewayPayment, IBkashPayment } from './bkashPayment.interface'
import { BkashPayment } from './bkashPayment.model'
import { writeAudit } from '../audit/audit.service'
import { PlatformSettings } from '../platformSettings/platformSettings.model'
import { calculateSubscriptionCharge } from '../billing/pricing'
import { ensurePaymentMatchesAttempt, isCompletedGatewayPayment, trustedBkashCheckoutUrl } from './bkashPayment.verification'
import { EntitlementService } from '../entitlement/entitlement.service'
import { publishSubscriptionEntitlementReconciliation, reconcileOrganizationEntitlements, type SubscriptionEntitlementReconciliationResult } from '../entitlement/subscriptionEntitlementReconciliation.service'
import { SubscriptionBenefitPeriodService } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.service'
import { SubscriptionScheduleService, classifySubscriptionChange } from '../subscription/subscriptionSchedule.service'
import { RealtimeService } from '../realtime/realtime.service'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'


const PAID_RENEWAL_STATUSES = new Set(['active', 'grace', 'cancel_at_period_end'])
const isoDateOrNull = (value: Date | null) => value ? value.toISOString() : null

const resolveCheckoutPlan = async (organization: any, requestedPlanId: IBkashPayment['planId']) => {
  const isGrandfatheredRenewal = organization?.subscription?.plan === requestedPlanId
    && Number(organization?.subscription?.planVersion || 0) > 0
    && PAID_RENEWAL_STATUSES.has(String(organization?.subscription?.status || ''))
  if (isGrandfatheredRenewal) {
    const assigned = await SubscriptionPlanService.getPlanById(requestedPlanId, Number(organization.subscription.planVersion))
    if (!assigned) throw new ApiError(httpStatus.CONFLICT, 'Your assigned subscription plan version no longer exists')
    return assigned
  }
  return SubscriptionPlanService.getLatestPurchasablePlan(requestedPlanId)
}

type CreatePaymentInput = {
  organizationId: string
  initiatedBy?: string
  planId: IBkashPayment['planId']
  billingCycle: IBkashPayment['billingCycle']
  idempotencyKey: string
}

const createPayment = async (input: CreatePaymentInput) => {
  const existing = await BkashPayment.findOne({
    organizationId: input.organizationId,
    idempotencyKey: input.idempotencyKey,
  })

  if (existing?.bkashURL && ['initialized', 'pending'].includes(existing.status)) {
    return {
      paymentId: existing.paymentId,
      bkashURL: existing.bkashURL,
      amount: existing.amount,
      currency: existing.currency,
      invoiceNumber: existing.invoiceNumber,
    }
  }

  const organization: any = await Organization.findOne({ organizationId: input.organizationId })
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (organization.subscription?.scheduledPlan) {
    throw new ApiError(httpStatus.CONFLICT, 'A paid subscription downgrade is already scheduled. Wait until it applies, or use an explicit billing adjustment/refund workflow before starting another checkout.')
  }
  // A normal same-plan renewal is priced and snapshotted from the tenant's assigned
  // immutable version. Selecting a different plan family is an explicit catalog change.
  const plan: any = await resolveCheckoutPlan(organization, input.planId)
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found')
  if (plan.currency !== 'BDT') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This plan is not configured for BDT payments')
  }

  const settings = await PlatformSettings.findOne({ key: 'platform' }).select('+tax.binEncrypted').lean()
  let charge
  try {
    charge = calculateSubscriptionCharge({
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      billingCycle: input.billingCycle,
      tax: settings?.tax ? { ...(settings.tax as any), binEncrypted: (settings.tax as any)?.binEncrypted || '' } : null,
    })
  } catch (error) {
    throw new ApiError(httpStatus.BAD_REQUEST, error instanceof Error ? error.message : 'Subscription plan price is invalid')
  }
  const { amount, taxSnapshot } = charge

  const invoiceNumber = `RE-${Date.now().toString(36).toUpperCase()}-${randomUUID()
    .slice(0, 6)
    .toUpperCase()}`

  let attempt
  try {
    attempt = await BkashPayment.create({
      organizationId: input.organizationId,
      initiatedBy: input.initiatedBy,
      planId: input.planId,
      planName: plan.name,
      planVersion: plan.version || 1,
      billingCycle: input.billingCycle,
      amount,
      currency: 'BDT',
      maxProperties: plan.maxProperties,
      maxAgents: plan.maxAgents,
      maxLeads: plan.maxLeads,
      taxSnapshot,
      invoiceNumber,
      idempotencyKey: input.idempotencyKey,
      status: 'initialized',
    })
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await BkashPayment.findOne({
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
      })
      if (duplicate?.bkashURL) {
        return {
          paymentId: duplicate.paymentId,
          bkashURL: duplicate.bkashURL,
          amount: duplicate.amount,
          currency: duplicate.currency,
          invoiceNumber: duplicate.invoiceNumber,
        }
      }
    }
    throw error
  }

  try {
    const callbackURL = `${config.public_api_url.replace(/\/$/, '')}/api/v1/billing/bkash/callback`
    const gatewayPayment = await BkashPaymentClient.createPayment({
      amount,
      callbackURL,
      invoiceNumber,
      payerReference: input.organizationId,
    })

    if (gatewayPayment.statusCode && gatewayPayment.statusCode !== '0000') {
      throw new ApiError(
        httpStatus.BAD_GATEWAY,
        gatewayPayment.statusMessage || 'bKash rejected the payment request'
      )
    }
    if (!gatewayPayment.paymentID) {
      throw new ApiError(httpStatus.BAD_GATEWAY, 'bKash returned no payment ID')
    }

    const bkashURL = trustedBkashCheckoutUrl(gatewayPayment.bkashURL)
    attempt.paymentId = gatewayPayment.paymentID
    attempt.bkashURL = bkashURL
    attempt.gatewayStatusCode = gatewayPayment.statusCode || ''
    attempt.gatewayStatusMessage = gatewayPayment.statusMessage || ''
    attempt.status = 'pending'
    await attempt.save()

    return {
      paymentId: attempt.paymentId,
      bkashURL,
      amount: attempt.amount,
      currency: attempt.currency,
      invoiceNumber: attempt.invoiceNumber,
    }
  } catch (error) {
    attempt.status = 'failed'
    attempt.gatewayStatusMessage = error instanceof Error ? error.message : 'Payment creation failed'
    await attempt.save()
    throw error
  }
}

const verifyGatewayPayment = async (paymentId: string): Promise<BkashGatewayPayment> => {
  try {
    const executed = await BkashPaymentClient.executePayment(paymentId)
    if (isCompletedGatewayPayment(executed)) return executed
  } catch {
    // A callback can be delivered more than once. Querying recovers an already-executed payment.
  }

  const queried = await BkashPaymentClient.queryPayment(paymentId)
  if (queried && isCompletedGatewayPayment(queried)) return queried

  throw new ApiError(
    httpStatus.BAD_GATEWAY,
    queried?.statusMessage || 'bKash payment could not be verified as completed'
  )
}

const activateSubscription = async (attempt: IBkashPayment, payment: BkashGatewayPayment) => {
  let reconciliation: SubscriptionEntitlementReconciliationResult | null = null
  let deferredDowngrade = false
  let scheduledEffectiveAt: Date | null = null

  await EntitlementService.withTeamMemberQuotaGuard(attempt.organizationId, async (session) => {
    const organizationQuery = Organization.findOne({ organizationId: attempt.organizationId })
    if (session) organizationQuery.session(session)
    const organization: any = await organizationQuery
    if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')

    const now = new Date()
    const previousSubscription = organization.subscription?.toObject?.() || { ...(organization.subscription || {}) }
    const currentPeriodEnd = organization.subscription?.currentPeriodEnd ? new Date(organization.subscription.currentPeriodEnd) : null
    const samePlan = organization.subscription?.plan === attempt.planId
    const changeType = await classifySubscriptionChange(String(organization.subscription?.plan || 'trial'), String(attempt.planId), { currentPlanVersion: Number(organization.subscription?.planVersion || 1), requestedPlanVersion: Number(attempt.planVersion || 1), session })
    deferredDowngrade = changeType === 'downgrade' && Boolean(currentPeriodEnd && currentPeriodEnd > now)
    const periodStart = new Date(deferredDowngrade && currentPeriodEnd
      ? currentPeriodEnd
      : samePlan && currentPeriodEnd && currentPeriodEnd > now
        ? currentPeriodEnd
        : now)
    const periodEnd = new Date(periodStart)
    if (attempt.billingCycle === 'yearly') periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1)
    else periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1)

    const planQuery = SubscriptionPlan.findOne({ planId: attempt.planId, version: attempt.planVersion || 1 })
    if (session) planQuery.session(session)
    const plan: any = await planQuery.lean()
    if (!plan) throw new ApiError(httpStatus.CONFLICT, 'The paid subscription plan version no longer exists')

    const benefitPeriodResult = await SubscriptionBenefitPeriodService.createForPaidSubscription({
      organizationId: attempt.organizationId,
      paymentSource: 'bkash',
      paymentNumber: attempt.paymentId || attempt.invoiceNumber,
      billingCycle: attempt.billingCycle,
      periodStart,
      periodEnd,
      plan: {
        planId: plan.planId,
        version: plan.version,
        leadAllowanceModel: plan.leadAllowanceModel === 'active_capacity' ? 'active_capacity' : 'paid_period_credits',
        baseMonthlyLeadAllowance: Number(plan.baseMonthlyLeadAllowance || 0),
        renewalLeadBonus: Number(plan.renewalLeadBonus || 0),
        renewalBonusEnabled: Boolean(plan.renewalBonusEnabled),
        maxRenewalLeadBonus: Number(plan.maxRenewalLeadBonus || 0),
        continuityGraceDays: Number(plan.continuityGraceDays || 0),
      },
    }, session)

    if (deferredDowngrade) {
      scheduledEffectiveAt = periodStart
      await SubscriptionScheduleService.scheduleDowngradeOnOrganization(organization, {
        planId: attempt.planId,
        planVersion: attempt.planVersion || 1,
        billingCycle: attempt.billingCycle,
        effectiveAt: periodStart,
        scheduledBy: attempt.initiatedBy || null,
        source: 'bkash',
        paidAt: now,
      }, session)
    } else {
      if (organization.subscription?.scheduledPlan) {
        throw new ApiError(httpStatus.CONFLICT, 'Another paid subscription change is already scheduled. Wait until it applies, or use an explicit billing adjustment/refund workflow before activating a different plan.')
      }
      organization.subscription = {
        ...(organization.subscription?.toObject?.() || organization.subscription || {}),
        plan: attempt.planId,
        planVersion: attempt.planVersion || 1,
        status: 'active',
        currentPeriodEnd: periodEnd,
        lastPaymentDate: now,
        maxProperties: attempt.maxProperties,
        maxAgents: attempt.maxAgents,
        gracePeriodEnd: null,
        cancelAtPeriodEnd: false,
        source: 'bkash',
        revision: Math.max(0, Number(organization.subscription?.revision || 0)) + 1,
      }
      await organization.save(session ? { session } : undefined)

      const effective = await EntitlementService.resolve(attempt.organizationId, session)
      reconciliation = await reconcileOrganizationEntitlements(attempt.organizationId, previousSubscription, {
        planId: attempt.planId,
        version: attempt.planVersion || 1,
        maxAgents: attempt.maxAgents,
        maxProperties: attempt.maxProperties,
        maxLeads: Number(effective.limits.maxLeads || 0),
        leadAllowanceModel: effective.limits.leadAllowanceModel === 'active_capacity' ? 'active_capacity' : 'paid_period_credits',
      }, {
        session,
        actorId: attempt.initiatedBy || 'system:bkash',
        reason: `bKash subscription changed to ${attempt.planId} v${attempt.planVersion || 1}`,
      })
    }

    const tax = attempt.taxSnapshot
    const taxSnapshot = { invoiceEnabled: Boolean(tax?.invoiceEnabled), registrationStatus: tax?.registrationStatus || 'not_registered' as const,
      operatorLegalName: tax?.operatorLegalName || '', binEncrypted: tax?.binEncrypted || '', vatRate: tax?.vatRate || 0,
      pricesIncludeVat: tax?.pricesIncludeVat ?? true, netAmount: tax?.baseAmount || attempt.amount, vatAmount: tax?.vatAmount || 0 }
    await Billing.findOneAndUpdate(
      { paymentId: attempt.paymentId },
      {
        $setOnInsert: {
          organizationId: attempt.organizationId,
          invoiceId: attempt.invoiceNumber,
          serviceType: 'subscription',
          serviceName: `${attempt.planName} Plan (${attempt.billingCycle})`,
          plan: attempt.planId,
          planVersion: attempt.planVersion || 1,
          billingCycle: attempt.billingCycle,
          date: now.toISOString().split('T')[0],
          amount: attempt.amount,
          currency: 'BDT',
          paymentId: attempt.paymentId,
          transactionId: payment.trxID || '',
          paymentMethod: 'bKash',
          status: 'paid',
          taxSnapshot,
        },
      },
      { upsert: true, new: true, ...(session ? { session } : {}) }
    )
    await writeAudit({ organizationId: attempt.organizationId, actorId: attempt.initiatedBy || 'system',
      action: deferredDowngrade ? 'subscription.downgrade_scheduled' : 'subscription.activated', entityType: 'bkashPayment', entityId: attempt.paymentId || '',
      metadata: { transactionId: payment.trxID || '', planId: attempt.planId, planVersion: attempt.planVersion || 1, billingCycle: attempt.billingCycle,
        changeType, deferredDowngrade, scheduledEffectiveAt, subscriptionEntitlementReconciliation: reconciliation,
        teamSeatReconciliation: reconciliation?.teamSeats || null, benefitPeriodId: String((benefitPeriodResult.period as any)._id),
        benefitRenewalStreak: (benefitPeriodResult.period as any).renewalStreak, benefitLeadAllowance: (benefitPeriodResult.period as any).totalLeadAllowance } }, session)
  })

  await CacheInvalidationService.invalidateTenant(attempt.organizationId)
  await publishSubscriptionEntitlementReconciliation(reconciliation)
  if (deferredDowngrade) {
    RealtimeService.emitOrganization(attempt.organizationId, {
      type: 'subscription.changed',
      action: 'scheduled',
      entityId: attempt.paymentId || attempt.invoiceNumber,
      eventType: 'subscription.downgrade_scheduled',
      payload: {
        plan: attempt.planId,
        planVersion: attempt.planVersion || 1,
        billingCycle: attempt.billingCycle,
        scheduledEffectiveAt: isoDateOrNull(scheduledEffectiveAt),
      },
    })
  }
}

const handleCallback = async (paymentId: string, callbackStatus: string) => {
  const attempt = await BkashPayment.findOne({ paymentId }).select('+taxSnapshot.binEncrypted')
  if (!attempt) throw new ApiError(httpStatus.NOT_FOUND, 'Payment attempt not found')

  if (callbackStatus === 'cancel' || callbackStatus === 'failure') {
    attempt.status = callbackStatus === 'cancel' ? 'cancelled' : 'failed'
    attempt.gatewayStatusMessage = `Checkout ${callbackStatus}`
    await attempt.save()
    return { status: attempt.status, paymentId }
  }
  if (callbackStatus !== 'success') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Unexpected bKash callback status')
  }
  if (attempt.status === 'succeeded') return { status: attempt.status, paymentId }

  const staleLock = new Date(Date.now() - 2 * 60 * 1000)
  const locked = await BkashPayment.findOneAndUpdate(
    {
      _id: attempt._id,
      $or: [
        { status: { $in: ['pending', 'failed'] } },
        { status: 'executing', updatedAt: { $lt: staleLock } },
      ],
    },
    { $set: { status: 'executing' } },
    { new: true }
  ).select('+taxSnapshot.binEncrypted')

  if (!locked) return { status: 'processing', paymentId }

  try {
    const verifiedPayment = await verifyGatewayPayment(paymentId)
    ensurePaymentMatchesAttempt(verifiedPayment, locked)
    await activateSubscription(locked, verifiedPayment)

    locked.status = 'succeeded'
    locked.transactionId = verifiedPayment.trxID || ''
    locked.payerAccount = verifiedPayment.payerAccount || ''
    locked.gatewayStatusCode = verifiedPayment.statusCode || ''
    locked.gatewayStatusMessage = verifiedPayment.statusMessage || ''
    await locked.save()

    return { status: locked.status, paymentId }
  } catch (error) {
    locked.status = 'failed'
    locked.gatewayStatusMessage = error instanceof Error ? error.message : 'Payment verification failed'
    await locked.save()
    throw error
  }
}

const getPaymentStatus = async (organizationId: string, paymentId: string) => {
  const payment = await BkashPayment.findOne({ organizationId, paymentId }).select(
    'paymentId invoiceNumber planId planName planVersion billingCycle amount currency status transactionId reconciliationNotes createdAt updatedAt'
  )
  if (!payment) throw new ApiError(httpStatus.NOT_FOUND, 'Payment attempt not found')
  return payment
}

const searchPayments = async (search: string, status?: string) => {
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const query: Record<string, unknown> = {}
  if (search) query.$or = ['paymentId', 'transactionId', 'invoiceNumber', 'organizationId'].map(field => ({ [field]: { $regex: escaped, $options: 'i' } }))
  if (status) query.status = status
  return BkashPayment.find(query).sort({ createdAt: -1, _id: -1 }).limit(100)
}

const manualReconcile = async (paymentId: string, reason: string, actor: { id: string; requestId?: string; ip?: string }) => {
  const attempt = await BkashPayment.findOne({ paymentId }).select('+taxSnapshot.binEncrypted')
  if (!attempt) throw new ApiError(404, 'Payment attempt not found')
  const gatewayPayment = await BkashPaymentClient.queryPayment(paymentId)
  if (!gatewayPayment || !isCompletedGatewayPayment(gatewayPayment)) throw new ApiError(409, 'bKash does not report this payment as completed')
  ensurePaymentMatchesAttempt(gatewayPayment, attempt)
  await activateSubscription(attempt, gatewayPayment)
  attempt.status = 'succeeded'; attempt.transactionId = gatewayPayment.trxID || ''; attempt.gatewayStatusCode = gatewayPayment.statusCode || ''
  attempt.gatewayStatusMessage = `Manually reconciled: ${reason}`; await attempt.save()
  await writeAudit({ organizationId: attempt.organizationId, actorId: actor.id, actorRole: 'super-admin', action: 'payment.manually_reconciled',
    entityType: 'bkashPayment', entityId: paymentId, reason, requestId: actor.requestId, ip: actor.ip,
    metadata: { trxID: gatewayPayment.trxID || '' } })
  return attempt
}

const reconcilePaymentAttempt = async (paymentId: string): Promise<boolean> => {
  const attempt = await BkashPayment.findOne({ paymentId, status: { $in: ['pending', 'failed'] } }).select('+taxSnapshot.binEncrypted')
  if (!attempt) return false
  const gatewayPayment = await BkashPaymentClient.queryPayment(paymentId)
  if (!gatewayPayment || !isCompletedGatewayPayment(gatewayPayment)) return false
  ensurePaymentMatchesAttempt(gatewayPayment, attempt)
  await activateSubscription(attempt, gatewayPayment)
  attempt.status = 'succeeded'; attempt.transactionId = gatewayPayment.trxID || ''; attempt.payerAccount = gatewayPayment.payerAccount || ''
  attempt.gatewayStatusCode = gatewayPayment.statusCode || ''; attempt.gatewayStatusMessage = gatewayPayment.statusMessage || 'Reconciled by scheduler'
  await attempt.save()
  return true
}

export const BkashPaymentService = { createPayment, handleCallback, getPaymentStatus, searchPayments, manualReconcile, reconcilePaymentAttempt }
