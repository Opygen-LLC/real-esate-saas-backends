import crypto from 'crypto'
import httpStatus from 'http-status'
import mongoose, { ClientSession } from 'mongoose'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { writeAudit } from '../audit/audit.service'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { Organization } from '../organization/organization.model'
import { SubscriptionChangeRequest } from '../subscriptionChangeRequest/subscriptionChangeRequest.model'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { SubscriptionPlanService } from '../subscriptionPlan/subscriptionPlan.service'
import { RealtimeService } from '../realtime/realtime.service'
import { SubscriptionPayment } from './subscriptionPayment.model'
import { ISubscriptionPayment, ManualPaymentMethod } from './subscriptionPayment.interface'
import { publishSubscriptionEntitlementReconciliation, reconcileOrganizationEntitlements } from '../entitlement/subscriptionEntitlementReconciliation.service'
import { SubscriptionBenefitPeriodService } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.service'

const safeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const serial = (prefix: string) => `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(10).toString('hex').toUpperCase()}`

const periodEnd = (start: Date, cycle: 'monthly' | 'yearly' | 'one-time') => {
  const end = new Date(start)
  if (cycle === 'monthly') end.setUTCMonth(end.getUTCMonth() + 1)
  else if (cycle === 'yearly') end.setUTCFullYear(end.getUTCFullYear() + 1)
  return end
}

const resolvePlan = async (planId: string, version?: number, session?: ClientSession) => {
  const query: any = { planId, isActive: true }
  if (version) query.version = version
  else query.isCurrent = true
  const finder = SubscriptionPlan.findOne(query)
  if (session) finder.session(session)
  const plan: any = await finder.lean()
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan version not found')
  return plan
}

const resolveLatestPurchasablePlan = async (planId: string) => {
  const plan: any = await SubscriptionPlanService.getLatestPurchasablePlan(planId)
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found')
  return typeof plan.toObject === 'function' ? plan.toObject() : plan
}

const priceFor = (plan: any, billingCycle: 'monthly' | 'yearly') => Number(billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly)

const fallbackPlanName = (planId: string) => String(planId || '')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())

const toChangeRequestContract = (request: any, requestedPlanName?: string) => {
  const plain = typeof request?.toObject === 'function' ? request.toObject() : { ...(request || {}) }
  return {
    ...plain,
    requestedPlanName: String(requestedPlanName || plain.requestedPlanName || fallbackPlanName(plain.requestedPlan)).trim(),
  }
}

const commercialTransaction = async <T>(work: (session?: ClientSession) => Promise<T>): Promise<T> => {
  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try {
      let value: T | undefined
      await session.withTransaction(async () => { value = await work(session) })
      if (value === undefined) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Commercial transaction did not complete')
      return value
    } finally { await session.endSession() }
  }
  if (config.env === 'production') {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Manual subscription payments require a MongoDB replica set or mongos in production')
  }
  return work()
}

const createChangeRequest = async (organizationId: string, requestedBy: string, input: { planId: string; billingCycle: 'monthly' | 'yearly' }) => {
  const [org, plan] = await Promise.all([
    Organization.findOne({ organizationId, isBlocked: { $ne: true } }).lean() as any,
    resolveLatestPurchasablePlan(input.planId),
  ])
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (org.subscription?.plan === plan.planId && Number(org.subscription?.planVersion || 1) === Number(plan.version) && ['active', 'grace', 'cancel_at_period_end'].includes(org.subscription?.status)) {
    throw new ApiError(httpStatus.CONFLICT, 'This is already your current subscription plan')
  }
  const existing: any = await SubscriptionChangeRequest.findOne({ organizationId, status: { $in: ['pending_payment', 'payment_submitted'] } }).sort({ createdAt: -1, _id: -1 }).lean()
  if (existing) throw new ApiError(httpStatus.CONFLICT, `A subscription request is already open (${existing.requestNumber}). Complete or cancel it first.`)
  let request: any
  try {
    request = await SubscriptionChangeRequest.create({
      requestNumber: serial('REQ'), organizationId,
      currentPlan: org.subscription?.plan || 'trial', currentPlanVersion: Number(org.subscription?.planVersion || 1),
      requestedPlan: plan.planId, requestedPlanName: plan.name || fallbackPlanName(plan.planId), requestedPlanVersion: plan.version, billingCycle: input.billingCycle,
      amount: priceFor(plan, input.billingCycle), currency: 'BDT', status: 'pending_payment', requestedBy,
    })
  } catch (error: any) {
    if (Number(error?.code) !== 11000) throw error
    const concurrent: any = await SubscriptionChangeRequest.findOne({ organizationId, status: { $in: ['pending_payment', 'payment_submitted'] } }).sort({ createdAt: -1, _id: -1 }).lean()
    throw new ApiError(httpStatus.CONFLICT, concurrent?.requestNumber
      ? `A subscription request is already open (${concurrent.requestNumber}). Complete or cancel it first.`
      : 'A subscription request is already open. Complete or cancel it first.')
  }
  await writeAudit({ organizationId, actorId: requestedBy, actorRole: 'agency_owner', action: 'subscription.change_requested', entityType: 'subscriptionChangeRequest', entityId: String(request._id), reason: 'Agency requested a manual subscription plan change', metadata: { requestNumber: request.requestNumber, requestedPlan: plan.planId, requestedPlanName: plan.name || fallbackPlanName(plan.planId), requestedPlanVersion: plan.version, billingCycle: input.billingCycle, amount: request.amount, currency: request.currency } })
  RealtimeService.emitRole('super-admin', {
    type: 'platform.notification.changed',
    action: 'created',
    entityId: String(request._id),
    eventType: 'subscription.change_requested',
    payload: {
      requestNumber: request.requestNumber,
      organizationId,
      requestedPlan: plan.planId,
      requestedPlanVersion: plan.version,
      billingCycle: input.billingCycle,
    },
  })
  return toChangeRequestContract(request, plan.name)
}

const getChangeRequests = async (organizationId: string) => {
  const requests: any[] = await SubscriptionChangeRequest.find({ organizationId }).sort({ createdAt: -1, _id: -1 }).limit(50).lean()
  const missing = requests.filter((request) => !request.requestedPlanName)
  if (!missing.length) return requests.map((request) => toChangeRequestContract(request))

  const keys = Array.from(new Set(missing.map((request) => `${request.requestedPlan}:${request.requestedPlanVersion}`)))
  const planClauses = keys.map((key) => {
    const [planId, version] = key.split(':')
    return { planId, version: Number(version) }
  })
  const plans: any[] = planClauses.length
    ? await SubscriptionPlan.find({ $or: planClauses }).select('planId version name').lean()
    : []
  const names = new Map(plans.map((plan) => [`${plan.planId}:${plan.version}`, plan.name]))
  return requests.map((request) => toChangeRequestContract(
    request,
    names.get(`${request.requestedPlan}:${request.requestedPlanVersion}`),
  ))
}

const cancelChangeRequest = async (organizationId: string, requestId: string, actorId: string) => {
  const request: any = await SubscriptionChangeRequest.findOne({ _id: requestId, organizationId })
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription request not found')
  if (request.status !== 'pending_payment') throw new ApiError(httpStatus.CONFLICT, 'Only requests waiting for payment can be cancelled')
  request.status = 'cancelled'; request.reviewedBy = actorId; request.reviewedAt = new Date(); await request.save()
  await writeAudit({ organizationId, actorId, actorRole: 'agency_owner', action: 'subscription.change_cancelled', entityType: 'subscriptionChangeRequest', entityId: String(request._id), reason: 'Agency cancelled the pending subscription request', metadata: { requestNumber: request.requestNumber } })
  RealtimeService.emitRole('super-admin', {
    type: 'platform.notification.changed',
    action: 'updated',
    entityId: String(request._id),
    eventType: 'subscription.change_cancelled',
    payload: { requestNumber: request.requestNumber, organizationId },
  })
  return toChangeRequestContract(request)
}

const getTenantPendingState = async (organizationId: string) => {
  const request: any = await SubscriptionChangeRequest.findOne({ organizationId, status: { $in: ['pending_payment', 'payment_submitted'] } }).sort({ createdAt: -1, _id: -1 }).lean()
  if (!request) return null
  const [payment, plan] = await Promise.all([
    request.paymentId ? SubscriptionPayment.findOne({ paymentNumber: request.paymentId }).lean() : null,
    request.requestedPlanName
      ? Promise.resolve(null)
      : SubscriptionPlan.findOne({ planId: request.requestedPlan, version: request.requestedPlanVersion }).select('name').lean(),
  ]) as [any, any]
  return {
    ...toChangeRequestContract(request, plan?.name),
    payment: payment ? { paymentNumber: payment.paymentNumber, status: payment.status, method: payment.method, reference: payment.reference, paidAt: payment.paidAt, amount: payment.amount } : null,
  }
}

const getTenantPaymentHistory = async (organizationId: string, query: any = {}) => {
  const page = Math.max(1, Number(query.page || 1))
  const limit = Math.min(100, Math.max(1, Number(query.limit || 20)))
  const allowedSortFields = new Set(['createdAt', 'paidAt', 'amount', 'status'])
  const sortBy = allowedSortFields.has(String(query.sortBy || '')) ? String(query.sortBy) : 'createdAt'
  const sortOrder = String(query.sortOrder || 'desc') === 'asc' ? 1 : -1
  const filter: any = { organizationId }
  const [data, total] = await Promise.all([
    SubscriptionPayment.find(filter).sort({ [sortBy]: sortOrder, _id: sortOrder }).skip((page - 1) * limit).limit(limit).lean(),
    SubscriptionPayment.countDocuments(filter),
  ])
  return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } }
}

const recordPayment = async (input: {
  organizationId: string; changeRequestId?: string; planId?: string; planVersion?: number; billingCycle?: 'monthly' | 'yearly';
  method: ManualPaymentMethod; reference?: string; paidAt?: Date; notes?: string; proofAssetId?: string
}, actor: { id: string; requestId?: string; ip?: string }) => {
  const created = await commercialTransaction(async (session) => {
    const orgQuery = Organization.findOne({ organizationId: input.organizationId, isBlocked: { $ne: true } })
    if (session) orgQuery.session(session)
    const org: any = await orgQuery
    if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')

    let request: any = null
    let plan: any
    let billingCycle: 'monthly' | 'yearly'
    let amount: number
    if (input.changeRequestId) {
      const requestQuery = SubscriptionChangeRequest.findOne({ _id: input.changeRequestId, organizationId: input.organizationId, status: { $in: ['pending_payment', 'payment_submitted'] } })
      if (session) requestQuery.session(session)
      request = await requestQuery
      if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Open subscription change request not found')
      const existingQuery = SubscriptionPayment.findOne({ changeRequestId: request._id, status: 'pending' })
      if (session) existingQuery.session(session)
      if (await existingQuery) throw new ApiError(httpStatus.CONFLICT, 'This subscription request already has a payment waiting for review')
      plan = await resolvePlan(request.requestedPlan, request.requestedPlanVersion, session)
      billingCycle = request.billingCycle
      amount = Number(request.amount)
    } else {
      if (!input.planId) throw new ApiError(httpStatus.BAD_REQUEST, 'Plan is required')
      plan = await resolvePlan(input.planId, input.planVersion, session)
      billingCycle = input.billingCycle || 'monthly'
      amount = priceFor(plan, billingCycle)
    }
    if (!Number.isFinite(amount) || amount < 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid payment amount')

    const docs = await SubscriptionPayment.create([{
      paymentNumber: serial('PAY'), receiptNumber: serial('RCT'), organizationId: input.organizationId,
      changeRequestId: request?._id || null, planId: plan.planId, planVersion: plan.version, billingCycle,
      amount, currency: 'BDT', method: input.method, reference: input.reference || '', paidAt: input.paidAt || new Date(),
      status: 'pending', notes: input.notes || '', proofAssetId: input.proofAssetId || null, recordedBy: actor.id, source: 'manual_admin',
    }], session ? { session } : undefined)
    const payment: any = docs[0]
    if (request) {
      request.status = 'payment_submitted'; request.paymentId = payment.paymentNumber; request.rejectionReason = ''
      await request.save(session ? { session } : undefined)
    }
    await writeAudit({ organizationId: input.organizationId, actorId: actor.id, actorRole: 'super-admin', action: 'subscription.payment_recorded', entityType: 'subscriptionPayment', entityId: String(payment._id), reason: input.notes || 'Manual subscription payment recorded', requestId: actor.requestId, ip: actor.ip, metadata: { paymentNumber: payment.paymentNumber, requestNumber: request?.requestNumber || null, plan: plan.planId, planVersion: plan.version, billingCycle, amount, method: input.method, reference: input.reference || '' } }, session)
    return payment.toObject()
  })
  return created
}

const decidePayment = async (paymentNumber: string, decision: { status: 'confirmed' | 'rejected'; reason?: string }, actor: { id: string; requestId?: string; ip?: string }) => {
  const transactionResult = await commercialTransaction(async (session) => {
    const paymentQuery = SubscriptionPayment.findOne({ paymentNumber })
    if (session) paymentQuery.session(session)
    const payment: any = await paymentQuery
    if (!payment) throw new ApiError(httpStatus.NOT_FOUND, 'Manual payment not found')
    if (payment.status !== 'pending') throw new ApiError(httpStatus.CONFLICT, `Payment is already ${payment.status}`)

    const orgQuery = Organization.findOne({ organizationId: payment.organizationId })
    if (session) orgQuery.session(session)
    const org: any = await orgQuery
    if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
    if (org.isBlocked && decision.status === 'confirmed') throw new ApiError(httpStatus.CONFLICT, 'Reactivate this tenant before confirming a subscription payment')

    let request: any = null
    if (payment.changeRequestId) {
      const requestQuery = SubscriptionChangeRequest.findById(payment.changeRequestId)
      if (session) requestQuery.session(session)
      request = await requestQuery
    }

    if (decision.status === 'rejected') {
      payment.status = 'rejected'; payment.rejectedReason = decision.reason || 'Payment rejected'; payment.rejectedBy = actor.id; payment.rejectedAt = new Date()
      await payment.save(session ? { session } : undefined)
      if (request && request.status === 'payment_submitted') {
        request.status = 'pending_payment'; request.paymentId = ''; request.rejectionReason = decision.reason || 'Payment rejected'; request.reviewedBy = actor.id; request.reviewedAt = new Date()
        await request.save(session ? { session } : undefined)
      }
      await writeAudit({ organizationId: payment.organizationId, actorId: actor.id, actorRole: 'super-admin', action: 'subscription.payment_rejected', entityType: 'subscriptionPayment', entityId: String(payment._id), reason: decision.reason || 'Payment rejected', requestId: actor.requestId, ip: actor.ip, metadata: { paymentNumber } }, session)
      return { organizationId: payment.organizationId, entitlementReconciliation: null }
    }

    const plan = await resolvePlan(payment.planId, payment.planVersion, session)
    const now = new Date()
    const samePlan = org.subscription?.plan === plan.planId
    const existingEnd = org.subscription?.currentPeriodEnd ? new Date(org.subscription.currentPeriodEnd) : null
    const start = samePlan && existingEnd && existingEnd > now ? existingEnd : now
    const end = periodEnd(start, payment.billingCycle)
    const previous = org.subscription?.toObject?.() || { ...(org.subscription || {}) }
    org.subscription = {
      ...(org.subscription?.toObject?.() || org.subscription || {}), plan: plan.planId, planVersion: plan.version, status: 'active',
      currentPeriodEnd: end, lastPaymentDate: payment.paidAt || now, trialEndsAt: null, gracePeriodEnd: null,
      cancelAtPeriodEnd: false, reminderSentAt: null, source: 'manual_payment', maxProperties: plan.maxProperties, maxAgents: plan.maxAgents,
    }
    await org.save(session ? { session } : undefined)
    const entitlementReconciliation = await reconcileOrganizationEntitlements(payment.organizationId, previous, plan, {
      session,
      actorId: actor.id,
      reason: `Subscription changed to ${plan.planId} v${plan.version}`,
    })
    payment.status = 'confirmed'; payment.confirmedBy = actor.id; payment.confirmedAt = now; payment.rejectedReason = ''; payment.periodStart = start; payment.periodEnd = end
    // Only confirmations performed by the new lifecycle are eligible for the one-time customer success modal.
    // This intentionally prevents legacy confirmed payments from replaying after deployment.
    payment.confirmationNoticeEligible = true
    payment.customerAcknowledgedBy = []
    await payment.save(session ? { session } : undefined)
    const benefitPeriodResult = await SubscriptionBenefitPeriodService.createForPaidSubscription({
      organizationId: payment.organizationId,
      paymentSource: 'manual_payment',
      paymentNumber: payment.paymentNumber,
      billingCycle: payment.billingCycle,
      periodStart: start,
      periodEnd: end,
      plan: {
        planId: plan.planId,
        version: plan.version,
        baseMonthlyLeadAllowance: Number(plan.baseMonthlyLeadAllowance || 0),
        renewalLeadBonus: Number(plan.renewalLeadBonus || 0),
        renewalBonusEnabled: Boolean(plan.renewalBonusEnabled),
        maxRenewalLeadBonus: Number(plan.maxRenewalLeadBonus || 0),
        continuityGraceDays: Number(plan.continuityGraceDays || 0),
      },
    }, session)
    if (request) {
      request.status = 'approved'; request.reviewedBy = actor.id; request.reviewedAt = now; request.rejectionReason = ''
      await request.save(session ? { session } : undefined)
    }
    await writeAudit({ organizationId: payment.organizationId, actorId: actor.id, actorRole: 'super-admin', action: 'subscription.payment_confirmed', entityType: 'subscriptionPayment', entityId: String(payment._id), reason: decision.reason || 'Manual subscription payment confirmed', requestId: actor.requestId, ip: actor.ip, metadata: { paymentNumber, receiptNumber: payment.receiptNumber, previousSubscription: previous, currentSubscription: org.subscription?.toObject?.() || org.subscription, subscriptionEntitlementReconciliation: entitlementReconciliation, teamSeatReconciliation: entitlementReconciliation.teamSeats, benefitPeriodId: String((benefitPeriodResult.period as any)._id), benefitRenewalStreak: (benefitPeriodResult.period as any).renewalStreak, benefitLeadAllowance: (benefitPeriodResult.period as any).totalLeadAllowance } }, session)
    return { organizationId: payment.organizationId, entitlementReconciliation }
  })
  const { organizationId, entitlementReconciliation } = transactionResult
  await CacheInvalidationService.invalidateTenant(organizationId)
  await publishSubscriptionEntitlementReconciliation(entitlementReconciliation)
  const result: any = await SubscriptionPayment.findOne({ paymentNumber }).lean()
  if (decision.status === 'confirmed' && result) {
    // Emit only after the commercial transaction has committed and tenant caches have been invalidated.
    // The payload deliberately excludes amount, method, reference, notes and proof metadata.
    RealtimeService.emitOrganization(organizationId, {
      type: 'subscription.changed',
      action: 'confirmed',
      entityId: result.paymentNumber,
      eventType: 'subscription.payment_confirmed',
      payload: {
        paymentNumber: result.paymentNumber,
        receiptNumber: result.receiptNumber,
        plan: result.planId,
        billingCycle: result.billingCycle,
        periodStart: result.periodStart ? new Date(result.periodStart).toISOString() : null,
        periodEnd: result.periodEnd ? new Date(result.periodEnd).toISOString() : null,
      },
    })
  }
  return result
}

const planDisplayName = (planId: string) => String(planId || '')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (character) => character.toUpperCase())

const getUnacknowledgedConfirmation = async (organizationId: string, userId: string) => {
  const payment: any = await SubscriptionPayment.findOne({
    organizationId,
    status: 'confirmed',
    confirmationNoticeEligible: true,
    customerAcknowledgedBy: { $ne: userId },
  })
    .sort({ confirmedAt: -1, _id: -1 })
    .select('organizationId paymentNumber receiptNumber planId planVersion billingCycle periodStart periodEnd confirmedAt')
    .lean()

  if (!payment) return null
  const plan: any = await SubscriptionPlan.findOne({ planId: payment.planId, version: payment.planVersion })
    .select('name')
    .lean()

  return {
    organizationId: payment.organizationId,
    paymentNumber: payment.paymentNumber,
    receiptNumber: payment.receiptNumber,
    planId: payment.planId,
    planName: plan?.name || planDisplayName(payment.planId),
    billingCycle: payment.billingCycle,
    periodStart: payment.periodStart || null,
    periodEnd: payment.periodEnd || null,
    confirmedAt: payment.confirmedAt || null,
  }
}

const acknowledgeConfirmation = async (organizationId: string, userId: string, paymentNumber: string) => {
  const payment: any = await SubscriptionPayment.findOneAndUpdate(
    { organizationId, paymentNumber, status: 'confirmed', confirmationNoticeEligible: true },
    { $addToSet: { customerAcknowledgedBy: userId } },
    { new: true },
  )
    .select('paymentNumber receiptNumber')
    .lean()
  if (!payment) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription confirmation not found')
  return { paymentNumber: payment.paymentNumber, receiptNumber: payment.receiptNumber, acknowledged: true as const }
}

const getPaymentLedger = async (query: any) => {
  const page = Math.max(1, Number(query.page || 1)); const limit = Math.min(100, Math.max(1, Number(query.limit || 20)))
  const filter: any = {}
  if (query.status) filter.status = query.status
  if (query.organizationId) filter.organizationId = String(query.organizationId)
  if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: new Date(String(query.from)) } : {}), ...(query.to ? { $lte: new Date(`${String(query.to)}T23:59:59.999Z`) } : {}) }
  if (query.search) {
    const regex = safeRegex(String(query.search).trim())
    filter.$or = ['paymentNumber', 'receiptNumber', 'reference', 'organizationId'].map(field => ({ [field]: { $regex: regex, $options: 'i' } }))
  }
  const [rows, total, summary] = await Promise.all([
    SubscriptionPayment.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    SubscriptionPayment.countDocuments(filter),
    SubscriptionPayment.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
  ])
  const ids = [...new Set(rows.map((row: any) => row.organizationId))]
  const orgs = await Organization.find({ organizationId: { $in: ids } }).select('organizationId agencyName email').lean()
  const orgMap = new Map(orgs.map((org: any) => [org.organizationId, org]))
  return { data: rows.map((row: any) => ({ ...row, organization: orgMap.get(row.organizationId) || null })), meta: { page, limit, total, totalPages: Math.ceil(total / limit), summary } }
}

const getRevenueDashboard = async () => {
  const now = new Date(); const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1))
  const [totals, month, latest, trend, status, active] = await Promise.all([
    SubscriptionPayment.aggregate([{ $match: { status: 'confirmed' } }, { $group: { _id: null, revenue: { $sum: '$amount' }, payments: { $sum: 1 } } }]),
    SubscriptionPayment.aggregate([{ $match: { status: 'confirmed', confirmedAt: { $gte: monthStart } } }, { $group: { _id: null, revenue: { $sum: '$amount' }, payments: { $sum: 1 } } }]),
    SubscriptionPayment.aggregate([{ $match: { status: 'confirmed' } }, { $sort: { confirmedAt: -1, _id: -1 } }, { $group: { _id: '$organizationId', amount: { $first: '$amount' }, billingCycle: { $first: '$billingCycle' } } }]),
    SubscriptionPayment.aggregate([{ $match: { status: 'confirmed', confirmedAt: { $gte: sixMonthsAgo } } }, { $group: { _id: { year: { $year: '$confirmedAt' }, month: { $month: '$confirmedAt' } }, revenue: { $sum: '$amount' }, payments: { $sum: 1 } } }, { $sort: { '_id.year': 1, '_id.month': 1 } }]),
    SubscriptionPayment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
    Organization.find({ isBlocked: { $ne: true }, 'subscription.status': { $in: ['active', 'grace', 'cancel_at_period_end'] }, 'subscription.plan': { $ne: 'trial' } }).select('organizationId').lean(),
  ])
  const activeIds = new Set(active.map((org: any) => org.organizationId))
  const mrr = latest.reduce((sum: number, row: any) => activeIds.has(String(row._id)) ? sum + (row.billingCycle === 'yearly' ? Number(row.amount || 0) / 12 : row.billingCycle === 'monthly' ? Number(row.amount || 0) : 0) : sum, 0)
  return { totalRevenue: totals[0]?.revenue || 0, paidInvoices: totals[0]?.payments || 0, monthRevenue: month[0]?.revenue || 0, monthInvoices: month[0]?.payments || 0, mrr: Number(mrr.toFixed(2)), activeSubscriptions: active.length, arpu: active.length ? Number((mrr / active.length).toFixed(2)) : 0, trend: trend.map((row: any) => ({ year: row._id.year, month: row._id.month, revenue: row.revenue, invoices: row.payments })), paymentStatus: status }
}

const getReceiptData = async (organizationId: string, id: string) => {
  const clauses: any[] = [{ paymentNumber: id }, { receiptNumber: id }]
  if (/^[0-9a-fA-F]{24}$/.test(id)) clauses.push({ _id: id })
  const payment: any = await SubscriptionPayment.findOne({ organizationId, status: 'confirmed', $or: clauses }).lean()
  if (!payment) throw new ApiError(httpStatus.NOT_FOUND, 'Confirmed subscription payment receipt not found')

  const [org, storedPlan] = await Promise.all([
    Organization.findOne({ organizationId }).select('agencyName email').lean() as any,
    SubscriptionPlan.findOne({ planId: payment.planId, version: payment.planVersion }).select('name planId version').lean() as any,
  ])
  const planName = storedPlan?.name || String(payment.planId).replace(/_/g, ' ').replace(/\b\w/g, (character: string) => character.toUpperCase())

  return {
    receiptNumber: payment.receiptNumber,
    paymentNumber: payment.paymentNumber,
    status: 'CONFIRMED' as const,
    agencyName: org?.agencyName || organizationId,
    customerEmail: org?.email || '',
    planName,
    planVersion: Number(payment.planVersion || 1),
    billingCycle: payment.billingCycle,
    periodStart: payment.periodStart || null,
    periodEnd: payment.periodEnd || null,
    paymentMethod: payment.method || 'manual',
    paymentReference: payment.reference || '',
    paidAt: payment.paidAt || payment.confirmedAt || payment.createdAt,
    confirmedAt: payment.confirmedAt || null,
    subtotal: Number(payment.amount || 0),
    total: Number(payment.amount || 0),
    currency: payment.currency || 'BDT',
  }
}

export const SubscriptionPaymentService = { createChangeRequest, getChangeRequests, cancelChangeRequest, getTenantPendingState, getTenantPaymentHistory, recordPayment, decidePayment, getUnacknowledgedConfirmation, acknowledgeConfirmation, getPaymentLedger, getRevenueDashboard, getReceiptData }
