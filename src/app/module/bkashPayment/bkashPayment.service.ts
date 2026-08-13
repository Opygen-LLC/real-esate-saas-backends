import { randomUUID } from 'crypto'
import httpStatus from 'http-status'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { Billing } from '../billing/billing.model'
import { Organization } from '../organization/organization.model'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { BkashPaymentClient } from './bkashPayment.client'
import { BkashGatewayPayment, IBkashPayment } from './bkashPayment.interface'
import { BkashPayment } from './bkashPayment.model'
import { writeAudit } from '../audit/audit.service'
import { PlatformSettings } from '../platformSettings/platformSettings.model'

type CreatePaymentInput = {
  organizationId: string
  initiatedBy?: string
  planId: IBkashPayment['planId']
  billingCycle: IBkashPayment['billingCycle']
  idempotencyKey: string
}

const trustedBkashCheckoutUrl = (value: string | undefined): string => {
  if (!value) throw new ApiError(httpStatus.BAD_GATEWAY, 'bKash returned no checkout URL')

  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    const isBkashHost =
      hostname === 'bka.sh' ||
      hostname.endsWith('.bka.sh') ||
      hostname === 'bkash.com' ||
      hostname.endsWith('.bkash.com')

    if (url.protocol !== 'https:' || !isBkashHost) throw new Error('Untrusted URL')
    return url.toString()
  } catch {
    throw new ApiError(httpStatus.BAD_GATEWAY, 'bKash returned an invalid checkout URL')
  }
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

  const [organization, plan] = await Promise.all([
    Organization.findOne({ organizationId: input.organizationId }),
    SubscriptionPlan.findOne({ planId: input.planId, isActive: true }),
  ])

  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found')
  if (plan.currency !== 'BDT') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This plan is not configured for BDT payments')
  }

  const baseAmount = input.billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly
  if (!Number.isFinite(baseAmount) || baseAmount < 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Subscription plan price is invalid')
  }
  const settings = await PlatformSettings.findOne({ key: 'platform' }).select('+tax.binEncrypted').lean()
  const registered = Boolean(settings?.tax?.invoiceEnabled && settings.tax.registrationStatus === 'registered')
  const vatRate = registered ? (settings?.tax?.vatRate || 0) : 0
  const pricesIncludeVat = settings?.tax?.pricesIncludeVat ?? true
  const vatAmount = registered && !pricesIncludeVat ? baseAmount * vatRate / 100 : registered && vatRate > 0 ? baseAmount - baseAmount / (1 + vatRate / 100) : 0
  const amount = Number((baseAmount + (registered && !pricesIncludeVat ? vatAmount : 0)).toFixed(2))
  const taxSnapshot = { invoiceEnabled: registered, registrationStatus: registered ? 'registered' as const : 'not_registered' as const,
    operatorLegalName: settings?.tax?.operatorLegalName || '', binEncrypted: (settings?.tax as any)?.binEncrypted || '', vatRate,
    pricesIncludeVat, baseAmount: Number((registered && pricesIncludeVat ? baseAmount - vatAmount : baseAmount).toFixed(2)), vatAmount: Number(vatAmount.toFixed(2)) }

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
      billingCycle: input.billingCycle,
      amount,
      currency: 'BDT',
      maxProperties: plan.maxProperties,
      maxAgents: plan.maxAgents,
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

const isCompletedGatewayPayment = (payment: BkashGatewayPayment | null): boolean => {
  if (!payment || payment.statusCode !== '0000') return false
  return !payment.transactionStatus || payment.transactionStatus.toLowerCase() === 'completed'
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

const ensurePaymentMatchesAttempt = (payment: BkashGatewayPayment, attempt: IBkashPayment) => {
  if (payment.paymentID && payment.paymentID !== attempt.paymentId) {
    throw new ApiError(httpStatus.BAD_GATEWAY, 'bKash payment ID mismatch')
  }
  if (payment.currency && payment.currency !== 'BDT') {
    throw new ApiError(httpStatus.BAD_GATEWAY, 'bKash payment currency mismatch')
  }

  const gatewayAmount = Number(payment.amount)
  if (!Number.isFinite(gatewayAmount) || Math.abs(gatewayAmount - attempt.amount) > 0.001) {
    throw new ApiError(httpStatus.BAD_GATEWAY, 'bKash payment amount mismatch')
  }
}

const activateSubscription = async (attempt: IBkashPayment, payment: BkashGatewayPayment) => {
  const organization = await Organization.findOne({ organizationId: attempt.organizationId })
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')

  const now = new Date()
  const currentPeriodEnd = organization.subscription?.currentPeriodEnd
  const isRenewal =
    organization.subscription?.plan === attempt.planId &&
    currentPeriodEnd instanceof Date &&
    currentPeriodEnd > now
  const periodEnd = new Date(isRenewal ? currentPeriodEnd : now)
  periodEnd.setMonth(periodEnd.getMonth() + (attempt.billingCycle === 'yearly' ? 12 : 1))

  await Organization.updateOne(
    { organizationId: attempt.organizationId },
    {
      $set: {
        'subscription.plan': attempt.planId,
        'subscription.status': 'active',
        'subscription.currentPeriodEnd': periodEnd,
        'subscription.lastPaymentDate': now,
        'subscription.maxProperties': attempt.maxProperties,
        'subscription.maxAgents': attempt.maxAgents,
        'subscription.gracePeriodEnd': null,
        'subscription.cancelAtPeriodEnd': false,
      },
    }
  )

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
    { upsert: true, new: true }
  )
  await writeAudit({ organizationId: attempt.organizationId, actorId: attempt.initiatedBy || 'system',
    action: 'subscription.activated', entityType: 'bkashPayment', entityId: attempt.paymentId || '',
    metadata: { transactionId: payment.trxID || '', planId: attempt.planId, billingCycle: attempt.billingCycle } })
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
    'paymentId invoiceNumber planId planName billingCycle amount currency status transactionId createdAt updatedAt'
  )
  if (!payment) throw new ApiError(httpStatus.NOT_FOUND, 'Payment attempt not found')
  return payment
}

const searchPayments = async (search: string, status?: string) => {
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const query: Record<string, unknown> = {}
  if (search) query.$or = ['paymentId', 'transactionId', 'invoiceNumber', 'organizationId'].map(field => ({ [field]: { $regex: escaped, $options: 'i' } }))
  if (status) query.status = status
  return BkashPayment.find(query).sort({ createdAt: -1 }).limit(100)
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
