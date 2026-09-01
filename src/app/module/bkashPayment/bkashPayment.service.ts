import { randomUUID } from 'crypto'
import httpStatus from 'http-status'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { Billing } from '../billing/billing.model'
import { Organization } from '../organization/organization.model'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { SubscriptionPlanService } from '../subscriptionPlan/subscriptionPlan.service'
import { resolvePlanLeadPolicy, toBenefitPlanSnapshot } from '../subscriptionPlan/planLeadPolicy'
import { BkashPaymentClient } from './bkashPayment.client'
import { BkashGatewayPayment, IBkashPayment } from './bkashPayment.interface'
import { BkashPayment } from './bkashPayment.model'
import { writeAudit } from '../audit/audit.service'
import { ensurePaymentMatchesAttempt, isCompletedGatewayPayment, trustedBkashCheckoutUrl } from './bkashPayment.verification'
import { EntitlementService } from '../entitlement/entitlement.service'
import { publishSubscriptionEntitlementReconciliation, reconcileOrganizationEntitlements, type SubscriptionEntitlementReconciliationResult } from '../entitlement/subscriptionEntitlementReconciliation.service'
import { SubscriptionBenefitPeriodService } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.service'
import { SubscriptionBenefitPeriod } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.model'
import { LeadTopupGrantService } from '../leadTopupGrant/leadTopupGrant.service'
import { LeadAddonSubscriptionService } from '../leadAddonSubscription/leadAddonSubscription.service'
import { SubscriptionScheduleService } from '../subscription/subscriptionSchedule.service'
import { SubscriptionQuoteService, type SubscriptionQuoteSnapshot } from '../subscription/subscriptionQuote.service'
import { RealtimeService } from '../realtime/realtime.service'
import { TenantAccessTransitionService } from '../tenantAccess/tenantAccessTransition.service'


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
      quote: existing.quoteSnapshot || null,
    }
  }

  const organization: any = await Organization.findOne({ organizationId: input.organizationId })
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (organization.subscription?.scheduledPlan) {
    throw new ApiError(httpStatus.CONFLICT, 'A paid subscription downgrade is already scheduled. Wait until it applies, or use an explicit billing adjustment/refund workflow before starting another checkout.')
  }

  // Same-plan renewals stay pinned to the tenant's immutable assigned version.
  // Cross-plan checkout resolves the current purchasable target version. The same
  // quote engine used by manual billing computes the authoritative amount.
  const plan: any = await resolveCheckoutPlan(organization, input.planId)
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found')
  if (plan.currency !== 'BDT') throw new ApiError(httpStatus.BAD_REQUEST, 'This plan is not configured for BDT payments')

  const quote = await SubscriptionQuoteService.quote(input.organizationId, {
    planId: plan.planId,
    planVersion: Number(plan.version || 1),
    billingCycle: input.billingCycle,
  })
  if (!Number.isFinite(quote.dueNow) || quote.dueNow <= 0) {
    throw new ApiError(httpStatus.CONFLICT, 'This subscription change has no positive amount due through bKash. Request a fresh billing quote or contact support.')
  }
  const publicQuote = SubscriptionQuoteService.toPublicQuote(quote) as SubscriptionQuoteSnapshot
  const { dueNow: amount, taxSnapshot } = quote

  const invoiceNumber = `RE-${Date.now().toString(36).toUpperCase()}-${randomUUID()
    .slice(0, 6)
    .toUpperCase()}`

  let attempt
  try {
    attempt = await BkashPayment.create({
      organizationId: input.organizationId,
      initiatedBy: input.initiatedBy,
      planId: plan.planId,
      planName: plan.name,
      planVersion: Number(plan.version || 1),
      billingCycle: input.billingCycle,
      amount,
      quoteSnapshot: publicQuote,
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
          quote: duplicate.quoteSnapshot || null,
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
      throw new ApiError(httpStatus.BAD_GATEWAY, gatewayPayment.statusMessage || 'bKash rejected the payment request')
    }
    if (!gatewayPayment.paymentID) throw new ApiError(httpStatus.BAD_GATEWAY, 'bKash returned no payment ID')

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
      quote: publicQuote,
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
  let activatedChangeType: SubscriptionQuoteSnapshot['changeType'] | null = null
  let renewalDatePreserved = false
  let previousSubscriptionStatus: string | null = null

  await EntitlementService.withTeamMemberQuotaGuard(attempt.organizationId, async (session) => {
    const organizationQuery = Organization.findOne({ organizationId: attempt.organizationId })
    if (session) organizationQuery.session(session)
    const organization: any = await organizationQuery
    if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')

    const now = new Date()
    const previousSubscription = organization.subscription?.toObject?.() || { ...(organization.subscription || {}) }
    previousSubscriptionStatus = String(previousSubscription.status || '') || null

    const planQuery = SubscriptionPlan.findOne({ planId: attempt.planId, version: attempt.planVersion || 1 })
    if (session) planQuery.session(session)
    const storedPlan: any = await planQuery.lean()
    if (!storedPlan) throw new ApiError(httpStatus.CONFLICT, 'The paid subscription plan version no longer exists')
    const plan: any = resolvePlanLeadPolicy(storedPlan)

    let quoteSnapshot = (attempt.quoteSnapshot || null) as SubscriptionQuoteSnapshot | null
    if (!quoteSnapshot) {
      // Legacy attempts created before this release did not persist an authoritative quote.
      // Re-quote them at activation time and refuse activation if the gateway amount no
      // longer matches; this avoids silently over/under-charging a mid-cycle upgrade.
      const freshQuote = await SubscriptionQuoteService.quote(attempt.organizationId, {
        planId: plan.planId,
        planVersion: Number(plan.version || 1),
        billingCycle: attempt.billingCycle,
        now,
      }, session)
      if (Math.abs(Number(attempt.amount) - Number(freshQuote.dueNow)) > 0.01) {
        throw new ApiError(httpStatus.CONFLICT, `This bKash payment was created for ৳${Number(attempt.amount).toFixed(2)}, but the authoritative subscription quote is now ৳${Number(freshQuote.dueNow).toFixed(2)}. Contact support for reconciliation.`)
      }
      quoteSnapshot = SubscriptionQuoteService.toPublicQuote(freshQuote) as SubscriptionQuoteSnapshot
      ;(attempt as any).quoteSnapshot = quoteSnapshot
    } else {
      SubscriptionQuoteService.assertSnapshotApplicable(organization, quoteSnapshot, now)
      await SubscriptionQuoteService.assertRecurringAddonSnapshotApplicable(attempt.organizationId, quoteSnapshot, session)
      if (Math.abs(Number(attempt.amount) - Number(quoteSnapshot.dueNow)) > 0.01) {
        throw new ApiError(httpStatus.CONFLICT, 'bKash payment amount does not match its authoritative subscription quote')
      }
    }

    const changeType = quoteSnapshot.changeType
    const quoteType = changeType
    activatedChangeType = quoteType
    const currentPeriodEnd = organization.subscription?.currentPeriodEnd ? new Date(organization.subscription.currentPeriodEnd) : null
    deferredDowngrade = changeType === 'downgrade' && Boolean(currentPeriodEnd && currentPeriodEnd > now)
    const midCycleImmediateChange = (quoteType === 'upgrade' || quoteType === 'version_change')
      && Boolean(quoteSnapshot.preserveRenewalDate && currentPeriodEnd && currentPeriodEnd > now)
    renewalDatePreserved = midCycleImmediateChange

    const periodStart = deferredDowngrade && currentPeriodEnd
      ? currentPeriodEnd
      : quoteType === 'renewal' && currentPeriodEnd && currentPeriodEnd > now
        ? currentPeriodEnd
        : now
    const periodEnd = midCycleImmediateChange && currentPeriodEnd
      ? currentPeriodEnd
      : SubscriptionQuoteService.addBillingCycle(periodStart, attempt.billingCycle)

    const previousBenefitQuery = SubscriptionBenefitPeriod.findOne({
      organizationId: attempt.organizationId,
      planId: String(organization.subscription?.plan || ''),
      planVersion: Number(organization.subscription?.planVersion || 1),
      periodStart: { $lte: now },
      periodEnd: { $gt: now },
      $or: [{ voidedAt: null }, { voidedAt: { $exists: false } }],
    }).sort({ periodStart: -1, _id: -1 })
    if (session) previousBenefitQuery.session(session)
    const previousBenefit: any = await previousBenefitQuery.lean()

    const benefitPeriodResult = await SubscriptionBenefitPeriodService.createForPaidSubscription({
      organizationId: attempt.organizationId,
      paymentSource: 'bkash',
      paymentNumber: attempt.paymentId || attempt.invoiceNumber,
      billingCycle: attempt.billingCycle,
      periodStart,
      periodEnd,
      plan: toBenefitPlanSnapshot(plan),
    }, session)


    if (quoteType === 'renewal' || deferredDowngrade) {
      await LeadAddonSubscriptionService.renewForSubscriptionPeriod(
        attempt.organizationId,
        periodStart,
        periodEnd,
        attempt.billingCycle,
        attempt.paymentId || attempt.invoiceNumber,
        String(plan.planId),
        Number(plan.version || 1),
        session,
      )
    }

    // A mid-cycle plan upgrade changes the active benefit-period identity. Existing
    // purchased top-up grants are rebound to that new period so customers do not lose
    // already-paid lead capacity merely because they upgraded the underlying plan.
    if (midCycleImmediateChange && previousBenefit?._id) {
      await LeadTopupGrantService.rebindActiveGrants(
        attempt.organizationId,
        previousBenefit._id,
        (benefitPeriodResult.period as any)._id,
        session,
      )
    }

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
        // Mid-cycle upgrades deliberately keep the old renewal boundary. Money is
        // prorated; features and lead capacity are granted in full immediately.
        currentPeriodEnd: periodEnd,
        lastPaymentDate: now,
        maxProperties: attempt.maxProperties,
        maxAgents: attempt.maxAgents,
        gracePeriodEnd: null,
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        reminderSentAt: null,
        source: 'bkash',
        revision: Math.max(0, Number(organization.subscription?.revision || 0)) + 1,
      }
      await organization.save(session ? { session } : undefined)

      const effective = await EntitlementService.resolve(attempt.organizationId, session)
      reconciliation = await reconcileOrganizationEntitlements(attempt.organizationId, previousSubscription, {
        planId: attempt.planId,
        version: attempt.planVersion || 1,
        maxAgents: attempt.maxAgents,
        maxLeads: Number(effective.limits.maxLeads || 0),
        maxTeamMembers: Number(effective.limits.maxTeamMembers || 0),
        maxProperties: Number(effective.limits.maxProperties || 0),
        maxStorageMb: Number(effective.limits.maxStorageMb || 0),
        hasCustomDomain: Boolean(effective.limits.hasCustomDomain),
        hasAdvancedAnalytics: Boolean(effective.limits.hasAdvancedAnalytics),
        hasWhatsAppIntegration: Boolean(effective.limits.hasWhatsAppIntegration),
        hasSmsAutomation: Boolean(effective.limits.hasSmsAutomation),
        hasPremiumTemplates: Boolean(effective.limits.hasPremiumTemplates),
        hasLeadAutomations: Boolean(effective.limits.hasLeadAutomations),
        leadAllowanceModel: effective.limits.leadAllowanceModel === 'active_capacity' ? 'active_capacity' : 'paid_period_credits',
        tenantOverrideApplied: true,
      }, {
        session,
        actorId: attempt.initiatedBy || 'system:bkash',
        reason: midCycleImmediateChange
          ? `Mid-cycle ${quoteType} activated for ${attempt.planId} v${attempt.planVersion || 1} without moving the renewal date`
          : `bKash subscription changed to ${attempt.planId} v${attempt.planVersion || 1}`,
      })
    }

    const tax = attempt.taxSnapshot
    const taxSnapshot = {
      invoiceEnabled: Boolean(tax?.invoiceEnabled),
      registrationStatus: tax?.registrationStatus || 'not_registered' as const,
      operatorLegalName: tax?.operatorLegalName || '',
      binEncrypted: tax?.binEncrypted || '',
      vatRate: tax?.vatRate || 0,
      pricesIncludeVat: tax?.pricesIncludeVat ?? true,
      netAmount: tax?.baseAmount ?? attempt.amount,
      vatAmount: tax?.vatAmount || 0,
    }
    await Billing.findOneAndUpdate(
      { paymentId: attempt.paymentId },
      {
        $setOnInsert: {
          organizationId: attempt.organizationId,
          invoiceId: attempt.invoiceNumber,
          serviceType: 'subscription',
          serviceName: `${attempt.planName} Plan (${attempt.billingCycle})${midCycleImmediateChange ? ' · prorated upgrade' : ''}${Number((quoteSnapshot as any).recurringAddonCount || 0) > 0 && (quoteType === 'renewal' || deferredDowngrade) ? ' + recurring lead add-ons' : ''}`,
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
    await writeAudit({
      organizationId: attempt.organizationId,
      actorId: attempt.initiatedBy || 'system',
      action: deferredDowngrade ? 'subscription.downgrade_scheduled' : 'subscription.activated',
      entityType: 'bkashPayment',
      entityId: attempt.paymentId || '',
      metadata: {
        transactionId: payment.trxID || '',
        planId: attempt.planId,
        planVersion: attempt.planVersion || 1,
        billingCycle: attempt.billingCycle,
        changeType: quoteType,
        deferredDowngrade,
        scheduledEffectiveAt,
        subscriptionEntitlementReconciliation: reconciliation,
        teamSeatReconciliation: reconciliation?.teamSeats || null,
        benefitPeriodId: String((benefitPeriodResult.period as any)._id),
        benefitRenewalStreak: (benefitPeriodResult.period as any).renewalStreak,
        benefitLeadAllowance: (benefitPeriodResult.period as any).totalLeadAllowance,
        quote: quoteSnapshot,
        renewalDatePreserved: midCycleImmediateChange,
      },
    }, session)
  })

  await publishSubscriptionEntitlementReconciliation(reconciliation)
  await TenantAccessTransitionService.sync({
    organizationId: attempt.organizationId,
    source: 'bkash_payment_confirmation',
    eventType: 'subscription.payment_confirmed',
    previousSubscriptionStatus,
  })
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
        changeType: activatedChangeType,
        scheduledEffectiveAt: isoDateOrNull(scheduledEffectiveAt),
        currentPeriodEnd: attempt.quoteSnapshot?.currentPeriodEnd ? new Date(attempt.quoteSnapshot.currentPeriodEnd).toISOString() : null,
        renewalDatePreserved,
      },
    })
  } else {
    RealtimeService.emitOrganization(attempt.organizationId, {
      type: 'subscription.changed',
      action: 'confirmed',
      entityId: attempt.paymentId || attempt.invoiceNumber,
      eventType: 'subscription.payment_confirmed',
      payload: {
        plan: attempt.planId,
        planVersion: attempt.planVersion || 1,
        billingCycle: attempt.billingCycle,
        changeType: activatedChangeType,
        scheduledEffectiveAt: isoDateOrNull(scheduledEffectiveAt),
        currentPeriodEnd: attempt.quoteSnapshot?.currentPeriodEnd ? new Date(attempt.quoteSnapshot.currentPeriodEnd).toISOString() : null,
        renewalDatePreserved,
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
  if (attempt.status === 'succeeded') {
    await TenantAccessTransitionService.sync({
      organizationId: attempt.organizationId,
      source: 'bkash_payment_confirmation_retry',
      eventType: 'subscription.payment_confirmed',
    })
    return { status: attempt.status, paymentId }
  }

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
