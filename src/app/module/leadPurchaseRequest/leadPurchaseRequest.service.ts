import crypto from 'crypto'
import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { writeAudit } from '../audit/audit.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { LeadEntitlementService } from '../lead/leadEntitlement.service'
import { Organization } from '../organization/organization.model'
import { RealtimeService } from '../realtime/realtime.service'
import { SubscriptionBenefitPeriod } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.model'
import { User } from '../user/user.model'
import { LeadTopupGrant } from '../leadTopupGrant/leadTopupGrant.model'
import { LeadTopupPricingService } from '../leadTopupPricing/leadTopupPricing.service'
import { LeadPurchaseRequest } from './leadPurchaseRequest.model'

const serial = () => `LPR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`
const safeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const paidAccessibleStatuses = new Set(['active', 'cancel_at_period_end'])

const withSession = <T extends { session: (session: ClientSession) => T }>(query: T, session?: ClientSession): T => {
  if (session) query.session(session)
  return query
}

const activePaidContext = async (organizationId: string, session?: ClientSession) => {
  const organizationQuery = Organization.findOne({ organizationId, isBlocked: { $ne: true } })
    .select('organizationId agencyName email subscription')
  const organization: any = await withSession(organizationQuery, session).lean()
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (organization.subscription?.plan === 'trial') {
    throw new ApiError(402, 'Trial workspaces must upgrade to a paid plan before purchasing additional leads.', '', 'PAID_PLAN_REQUIRED', { upgradeRequired: true })
  }
  if (!paidAccessibleStatuses.has(String(organization.subscription?.status || ''))) {
    throw new ApiError(402, 'An active paid subscription is required to purchase additional leads.', '', 'SUBSCRIPTION_INACTIVE', { subscriptionStatus: organization.subscription?.status, upgradeRequired: true })
  }

  const now = new Date()
  const benefitQuery = SubscriptionBenefitPeriod.findOne({
    organizationId,
    planId: organization.subscription.plan,
    planVersion: organization.subscription.planVersion,
    periodStart: { $lte: now },
    periodEnd: { $gt: now },
    $or: [{ voidedAt: null }, { voidedAt: { $exists: false } }],
  }).sort({ periodStart: -1, _id: -1 })
  const benefit: any = await withSession(benefitQuery, session).lean()
  if (!benefit) throw new ApiError(httpStatus.CONFLICT, 'No active paid benefit period is available for a lead top-up. Renew or confirm the subscription first.', '', 'LEAD_BENEFIT_PERIOD_INACTIVE')
  return { organization, benefit }
}

const reconcileExpiredPending = async (organizationId?: string) => {
  const filter: Record<string, unknown> = { status: 'pending', expiresAt: { $lte: new Date() } }
  if (organizationId) filter.organizationId = organizationId
  await LeadPurchaseRequest.updateMany(filter, {
    $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'system:billing-period-ended' },
  })
}

const tenantRequests = async (organizationId: string) => {
  await reconcileExpiredPending(organizationId)
  return LeadPurchaseRequest.find({ organizationId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(50)
    .lean()
}

const createRequest = async (organizationId: string, requestedBy: string, actorRole: string, input: { pricingRuleId: string; requestedLeads: number }) => {
  await reconcileExpiredPending(organizationId)
  const existing: any = await LeadPurchaseRequest.findOne({ organizationId, status: 'pending' }).sort({ createdAt: -1, _id: -1 }).lean()
  if (existing) throw new ApiError(httpStatus.CONFLICT, `A lead purchase request is already pending (${existing.requestNumber}).`)

  const { organization, benefit } = await activePaidContext(organizationId)
  const [quote, allowance] = await Promise.all([
    LeadTopupPricingService.quote(input.pricingRuleId, input.requestedLeads),
    EntitlementService.getMonthlyLeadAllowanceSnapshot(organizationId),
  ])
  const now = new Date()
  const expiresAt = new Date(benefit.periodEnd)
  if (expiresAt.getTime() <= now.getTime()) throw new ApiError(httpStatus.CONFLICT, 'The current billing period has ended. Renew before requesting additional leads.')

  let request: any
  try {
    request = await LeadPurchaseRequest.create({
      requestNumber: serial(),
      organizationId,
      requestedBy,
      currentPlan: String(organization.subscription.plan),
      currentPlanVersion: Number(organization.subscription.planVersion || benefit.planVersion || 1),
      currentLeadCapacity: Math.max(0, Number(allowance.limit || 0)),
      currentLeadUsage: Math.max(0, Number(allowance.used || 0)),
      requestedLeads: quote.requestedLeads,
      benefitPeriodId: benefit._id,
      pricingRuleId: quote.pricingRuleId,
      pricingMode: quote.pricingMode,
      pricingName: quote.pricingName,
      leadsPerUnit: quote.leadsPerUnit,
      pricePerUnit: quote.pricePerUnit,
      totalAmount: quote.totalAmount,
      currency: quote.currency,
      status: 'pending',
      requestedAt: now,
      expiresAt,
    })
  } catch (error: any) {
    if (Number(error?.code) !== 11000) throw error
    const concurrent: any = await LeadPurchaseRequest.findOne({ organizationId, status: 'pending' }).sort({ createdAt: -1, _id: -1 }).lean()
    throw new ApiError(httpStatus.CONFLICT, concurrent?.requestNumber ? `A lead purchase request is already pending (${concurrent.requestNumber}).` : 'A lead purchase request is already pending.')
  }

  await writeAudit({ organizationId, actorId: requestedBy, actorRole, action: 'lead_topup.requested', entityType: 'leadPurchaseRequest', entityId: String(request._id), reason: 'Agency requested additional lead capacity', metadata: { requestNumber: request.requestNumber, requestedLeads: request.requestedLeads, totalAmount: request.totalAmount, pricingRuleId: String(request.pricingRuleId), benefitPeriodId: String(request.benefitPeriodId), expiresAt: request.expiresAt } })
  RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'created', entityId: String(request._id) })
  return request
}

const cancelRequest = async (organizationId: string, requestId: string, actorId: string, actorRole: string) => {
  const request: any = await LeadPurchaseRequest.findOneAndUpdate(
    { _id: requestId, organizationId, status: 'pending' },
    { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: actorId } },
    { new: true },
  )
  if (!request) {
    const existing: any = await LeadPurchaseRequest.findOne({ _id: requestId, organizationId }).lean()
    if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Lead purchase request not found')
    throw new ApiError(httpStatus.CONFLICT, `Only pending requests can be cancelled. Current status: ${existing.status}`)
  }
  await writeAudit({ organizationId, actorId, actorRole, action: 'lead_topup.request_cancelled', entityType: 'leadPurchaseRequest', entityId: String(request._id), reason: 'Agency cancelled additional lead request', metadata: { requestNumber: request.requestNumber } })
  RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'updated', entityId: String(request._id) })
  return request
}

const adminList = async (query: any = {}) => {
  await reconcileExpiredPending()
  const page = Math.max(1, Number(query.page || 1))
  const limit = Math.min(100, Math.max(1, Number(query.limit || 20)))
  const filter: any = {}
  if (query.status && query.status !== 'all') filter.status = String(query.status)
  const search = String(query.search || '').trim()
  if (search) {
    const rx = new RegExp(safeRegex(search), 'i')
    const [organizations, requesters] = await Promise.all([
      Organization.find({ $or: [{ agencyName: rx }, { organizationId: rx }, { email: rx }] }).select('organizationId').limit(100).lean(),
      User.find({ $or: [{ name: rx }, { email: rx }] }).select('_id').limit(100).lean(),
    ])
    filter.$or = [
      { requestNumber: rx },
      { organizationId: { $in: organizations.map((row: any) => row.organizationId) } },
      { requestedBy: { $in: requesters.map((row: any) => String(row._id)) } },
    ]
  }
  const [rows, total, summaryRows] = await Promise.all([
    LeadPurchaseRequest.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    LeadPurchaseRequest.countDocuments(filter),
    LeadPurchaseRequest.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$totalAmount' }, leads: { $sum: '$requestedLeads' } } }]),
  ])
  const [organizations, requesters] = await Promise.all([
    Organization.find({ organizationId: { $in: [...new Set(rows.map((row: any) => row.organizationId))] } })
      .select('organizationId agencyName email subscription.plan subscription.planVersion subscription.status subscription.currentPeriodEnd')
      .lean(),
    User.find({ _id: { $in: [...new Set(rows.map((row: any) => row.requestedBy).filter(Boolean))] } })
      .select('_id name email userRole')
      .lean(),
  ])
  const orgMap = new Map(organizations.map((row: any) => [row.organizationId, row]))
  const requesterMap = new Map(requesters.map((row: any) => [String(row._id), row]))
  const summary = Object.fromEntries(summaryRows.map((row: any) => [String(row._id), { count: Number(row.count || 0), amount: Number(row.amount || 0), leads: Number(row.leads || 0) }]))
  return { data: rows.map((row: any) => ({ ...row, organization: orgMap.get(row.organizationId) || null, requester: requesterMap.get(String(row.requestedBy)) || null })), meta: { page, limit, total, totalPages: Math.ceil(total / limit), summary } }
}

const transaction = async <T>(work: (session?: ClientSession) => Promise<T>): Promise<T> => {
  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try {
      let result: T | undefined
      await session.withTransaction(async () => { result = await work(session) })
      if (result === undefined) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Lead top-up transaction did not complete')
      return result
    } finally { await session.endSession() }
  }
  if (config.env === 'production') throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Lead top-up approval requires a MongoDB replica set or mongos in production')
  return work()
}

const approve = async (requestId: string, actorId: string, requestMeta: { requestId?: string; ip?: string }) => {
  let capacityChange: Awaited<ReturnType<typeof LeadEntitlementService.reconcileLeadCapacity>> | null = null
  const result = await transaction(async (session) => {
    const query = LeadPurchaseRequest.findById(requestId)
    if (session) query.session(session)
    const request: any = await query
    if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Lead purchase request not found')
    if (request.status === 'approved') {
      const grantQuery = LeadTopupGrant.findOne({ approvedRequestId: request._id })
      if (session) grantQuery.session(session)
      return { request, grant: await grantQuery, idempotent: true }
    }
    if (request.status !== 'pending') throw new ApiError(httpStatus.CONFLICT, `Only pending requests can be approved. Current status: ${request.status}`)
    if (new Date(request.expiresAt).getTime() <= Date.now()) throw new ApiError(httpStatus.CONFLICT, 'This request belongs to an expired billing period. Ask the customer to create a new request.')

    const { organization, benefit } = await activePaidContext(request.organizationId, session)
    if (String(benefit._id) !== String(request.benefitPeriodId)
      || String(organization.subscription.plan) !== String(request.currentPlan)
      || Number(organization.subscription.planVersion || 0) !== Number(request.currentPlanVersion || 0)) {
      throw new ApiError(httpStatus.CONFLICT, 'The customer subscription changed after this request was submitted. Ask the customer to create a new lead purchase request.')
    }

    const mutex = await Organization.updateOne({ organizationId: request.organizationId }, { $inc: { leadQuotaRevision: 1 } }, session ? { session } : undefined)
    if (!mutex.matchedCount) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')

    let grant: any
    try {
      const docs = await LeadTopupGrant.create([{
        organizationId: request.organizationId,
        benefitPeriodId: request.benefitPeriodId,
        approvedRequestId: request._id,
        requestedLeads: request.requestedLeads,
        grantedLeads: request.requestedLeads,
        effectiveAt: new Date(),
        expiresAt: new Date(request.expiresAt),
        approvedBy: actorId,
      }], session ? { session } : undefined)
      grant = docs[0]
    } catch (error: any) {
      if (Number(error?.code) !== 11000) throw error
      const grantQuery = LeadTopupGrant.findOne({ approvedRequestId: request._id })
      if (session) grantQuery.session(session)
      grant = await grantQuery
      if (!grant) throw error
    }

    request.status = 'approved'
    request.approvedAt = new Date()
    request.approvedBy = actorId
    await request.save(session ? { session } : undefined)

    const resolved = await EntitlementService.resolve(request.organizationId, session)
    if (resolved.limits.leadAllowanceModel === 'active_capacity') {
      capacityChange = await LeadEntitlementService.reconcileLeadCapacity(request.organizationId, Number(resolved.limits.maxLeads || 0), session, actorId)
    }

    await writeAudit({ organizationId: request.organizationId, actorId, actorRole: 'super-admin', action: 'lead_topup.approved', entityType: 'leadPurchaseRequest', entityId: String(request._id), reason: 'Super Admin approved additional lead capacity', requestId: requestMeta.requestId, ip: requestMeta.ip, metadata: { requestNumber: request.requestNumber, requestedLeads: request.requestedLeads, totalAmount: request.totalAmount, grantId: String(grant._id), benefitPeriodId: String(request.benefitPeriodId), expiresAt: request.expiresAt } }, session)
    return { request, grant, idempotent: false }
  })

  if (result.idempotent) return result
  if (capacityChange) await LeadEntitlementService.publishCapacityChange(result.request.organizationId, capacityChange)
  RealtimeService.emitOrganization(result.request.organizationId, { type: 'billing.changed', action: 'lead_topup_approved', entityId: String(result.request._id), payload: { requestedLeads: result.request.requestedLeads, expiresAt: result.request.expiresAt } })
  RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'updated', entityId: String(result.request._id) })
  return result
}

const reject = async (requestId: string, actorId: string, reason: string, requestMeta: { requestId?: string; ip?: string }) => {
  const request: any = await LeadPurchaseRequest.findOneAndUpdate(
    { _id: requestId, status: 'pending' },
    { $set: { status: 'rejected', rejectedAt: new Date(), rejectedBy: actorId, rejectionReason: reason } },
    { new: true },
  )
  if (!request) {
    const existing: any = await LeadPurchaseRequest.findById(requestId).lean()
    if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Lead purchase request not found')
    throw new ApiError(httpStatus.CONFLICT, `Only pending requests can be rejected. Current status: ${existing.status}`)
  }
  await writeAudit({ organizationId: request.organizationId, actorId, actorRole: 'super-admin', action: 'lead_topup.rejected', entityType: 'leadPurchaseRequest', entityId: String(request._id), reason, requestId: requestMeta.requestId, ip: requestMeta.ip, metadata: { requestNumber: request.requestNumber, requestedLeads: request.requestedLeads, totalAmount: request.totalAmount } })
  RealtimeService.emitOrganization(request.organizationId, { type: 'billing.changed', action: 'lead_topup_rejected', entityId: String(request._id) })
  RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'updated', entityId: String(request._id) })
  return request
}

const decide = async (requestId: string, actorId: string, input: { status: 'approved' | 'rejected'; reason?: string }, requestMeta: { requestId?: string; ip?: string }) => {
  if (input.status === 'approved') return approve(requestId, actorId, requestMeta)
  return { request: await reject(requestId, actorId, String(input.reason || ''), requestMeta), grant: null, idempotent: false }
}

export const LeadPurchaseRequestService = { tenantRequests, createRequest, cancelRequest, adminList, decide }
