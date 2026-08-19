import { Secret } from 'jsonwebtoken'
import httpStatus from 'http-status'
import mongoose from 'mongoose'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { jwtHelpers } from '../../helpers/jwtHelpers'
import { AuditEvent } from '../audit/audit.model'
import { writeAudit } from '../audit/audit.service'
import { DomainRecord } from '../domain/domain.model'
import { DomainEvent } from '../domainEvent/domainEvent.model'
import { Lead } from '../lead/lead.model'
import { activePipelineLeadFilter } from '../lead/leadStatus.contract'
import { MetaEvent } from '../metaIntegration/metaEvent.model'
import { OperationsJob } from '../operationsQueue/operationsJob.model'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { RealtimeService } from '../realtime/realtime.service'
import { ImpersonationSession } from './impersonationSession.model'
import { AuthSession } from '../auth/authSession.model'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { getTrialPolicy, trialEndFromPolicy } from '../platformSettings/trialPolicy.service'
import { SubscriptionPayment } from '../subscriptionPayment/subscriptionPayment.model'
import { SubscriptionPaymentService } from '../subscriptionPayment/subscriptionPayment.service'
import { SubscriptionChangeRequest } from '../subscriptionChangeRequest/subscriptionChangeRequest.model'
import { toTeamMemberLimitContract } from '../../../contracts/workspaceContracts'

const safeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const clampLimit = (value: unknown, fallback = 25) => Math.min(100, Math.max(1, Number(value || fallback)))

const groupCounts = async (model: any, ids: string[], match: Record<string, unknown> = {}) => {
  const rows = await model.aggregate([
    { $match: { organizationId: { $in: ids }, ...match } },
    { $group: { _id: '$organizationId', count: { $sum: 1 } } },
  ])
  return new Map(rows.map((row: any) => [String(row._id), Number(row.count || 0)]))
}

const getTenantHealth = async (query: any) => {
  const page = Math.max(1, Number(query.page || 1))
  const limit = clampLimit(query.limit, 10)
  const filter: any = {}
  if (query.status === 'suspended') filter.isBlocked = true
  if (query.status === 'active') filter.isBlocked = { $ne: true }
  if (query.plan) filter['subscription.plan'] = query.plan
  if (query.search) {
    const regex = safeRegex(String(query.search).trim())
    const domainOrganizations = await DomainRecord.distinct('organizationId', { domain: { $regex: regex, $options: 'i' } })
    filter.$or = [
      ...['agencyName', 'email', 'phone', 'organizationId', 'domain', 'sub_domain'].map((field) => ({ [field]: { $regex: regex, $options: 'i' } })),
      ...(domainOrganizations.length ? [{ organizationId: { $in: domainOrganizations } }] : []),
    ]
  }
  const [organizations, total] = await Promise.all([
    Organization.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Organization.countDocuments(filter),
  ])
  const ids = organizations.map((org: any) => org.organizationId)
  if (!ids.length) return { data: [], meta: { page, limit, total } }

  const [properties, teamMembers, leads, domains, latestEvents, latestPayments, latestRequests, failedJobs, deadMeta] = await Promise.all([
    groupCounts(Property, ids, { status: { $ne: 'Archived' } }),
    groupCounts(User, ids, { userRole: { $in: ['agency_owner', 'agency_admin', 'agent', 'staff'] }, status: { $ne: 'blocked' } }),
    groupCounts(Lead, ids, activePipelineLeadFilter()),
    DomainRecord.find({ organizationId: { $in: ids } }).select('organizationId domain status tlsStatus lastCheckedAt diagnostics').lean(),
    DomainEvent.aggregate([{ $match: { organizationId: { $in: ids } } }, { $sort: { occurredAt: -1 } }, { $group: { _id: '$organizationId', at: { $first: '$occurredAt' }, type: { $first: '$eventType' } } }]),
    SubscriptionPayment.aggregate([{ $match: { organizationId: { $in: ids } } }, { $sort: { createdAt: -1 } }, { $group: { _id: '$organizationId', payment: { $first: '$$ROOT' } } }]),
    SubscriptionChangeRequest.aggregate([{ $match: { organizationId: { $in: ids }, status: { $in: ['pending_payment', 'payment_submitted'] } } }, { $sort: { createdAt: -1 } }, { $group: { _id: '$organizationId', request: { $first: '$$ROOT' } } }]),
    groupCounts(OperationsJob, ids, { status: 'failed' }),
    groupCounts(MetaEvent, ids, { status: 'dead' }),
  ])
  const domainMap = new Map(domains.map((row: any) => [row.organizationId, row]))
  const eventMap = new Map(latestEvents.map((row: any) => [String(row._id), row]))
  const paymentMap = new Map(latestPayments.map((row: any) => [String(row._id), row.payment]))
  const requestMap = new Map(latestRequests.map((row: any) => [String(row._id), row.request]))

  const data = organizations.map((org: any) => {
    const domain: any = domainMap.get(org.organizationId)
    const payment: any = paymentMap.get(org.organizationId)
    const pendingRequest: any = requestMap.get(org.organizationId)
    const errorCount = Number(failedJobs.get(org.organizationId) || 0) + Number(deadMeta.get(org.organizationId) || 0) + (domain?.status === 'failed' || domain?.tlsStatus === 'failed' ? 1 : 0)
    const health = org.isBlocked ? 'suspended' : (errorCount > 0 || ['past_due', 'expired'].includes(org.subscription?.status) || ['rejected'].includes(payment?.status)) ? 'attention' : 'healthy'
    return {
      _id: org._id,
      organizationId: org.organizationId,
      agencyName: org.agencyName,
      email: org.email,
      phone: org.phone,
      location: [org.city, org.state, org.country].filter(Boolean).join(', '),
      createdAt: org.createdAt,
      plan: org.subscription?.plan || 'trial',
      planVersion: org.subscription?.planVersion || 1,
      paymentState: payment?.status || (pendingRequest ? pendingRequest.status : org.subscription?.plan === 'trial' ? 'trial' : 'none'),
      paymentId: payment?.paymentNumber || '',
      pendingChangeRequest: pendingRequest ? { _id: pendingRequest._id, requestNumber: pendingRequest.requestNumber, requestedPlan: pendingRequest.requestedPlan, requestedPlanVersion: pendingRequest.requestedPlanVersion, billingCycle: pendingRequest.billingCycle, amount: pendingRequest.amount, status: pendingRequest.status, paymentId: pendingRequest.paymentId, createdAt: pendingRequest.createdAt, rejectionReason: pendingRequest.rejectionReason } : null,
      subscriptionStatus: org.subscription?.status || 'trialing',
      currentPeriodEnd: org.subscription?.currentPeriodEnd,
      trialEndsAt: org.subscription?.trialEndsAt,
      subscriptionSource: org.subscription?.source || 'trial',
      usage: {
        properties: properties.get(org.organizationId) || 0,
        teamMembers: teamMembers.get(org.organizationId) || 0,
        agents: teamMembers.get(org.organizationId) || 0,
        leads: leads.get(org.organizationId) || 0,
        storageUsedBytes: org.storageUsedBytes || 0,
        monthlyVisitors: org.monthlyVisitorCount || 0,
      },
      domain: domain ? { host: domain.domain, status: domain.status, tlsStatus: domain.tlsStatus, lastCheckedAt: domain.lastCheckedAt } : null,
      lastActivity: eventMap.get(org.organizationId) || { at: org.updatedAt, type: 'organization.updated' },
      errors: errorCount,
      isBlocked: Boolean(org.isBlocked),
      platformAccess: org.platformAccess,
      health,
    }
  })
  return { data, meta: { page, limit, total } }
}

const suspendTenant = async (organizationId: string, actor: { id: string; reason: string; requestId?: string; ip?: string }) => {
  const org: any = await Organization.findOne({ organizationId })
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (org.isBlocked) throw new ApiError(httpStatus.CONFLICT, 'Organization is already suspended')
  const previousSubscriptionStatus = org.subscription?.status || 'active'
  const previousWebsiteStatus = org.websiteStatus || 'published'
  org.isBlocked = true
  org.websiteStatus = 'suspended'
  org.platformAccess = {
    ...(org.platformAccess?.toObject?.() || org.platformAccess || {}),
    status: 'suspended', suspendedAt: new Date(), suspendedBy: actor.id, suspensionReason: actor.reason,
    previousSubscriptionStatus, previousWebsiteStatus, suspensionSource: 'tenant', suspensionUserId: null,
  }
  if (org.subscription) org.subscription.status = 'suspended'
  await org.save()
  await Promise.all([
    AuthSession.updateMany({ organizationId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: 'tenant_suspended' } }),
    CacheInvalidationService.invalidateTenant(organizationId),
  ])
  await writeAudit({ organizationId, actorId: actor.id, actorRole: 'super-admin', action: 'organization.suspended', entityType: 'organization', entityId: org._id.toString(), reason: actor.reason, requestId: actor.requestId, ip: actor.ip, metadata: { previousSubscriptionStatus, previousWebsiteStatus } })
  RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'updated', entityId: 'tenant_suspended' })
  return org
}

const reactivateTenant = async (organizationId: string, actor: { id: string; reason: string; requestId?: string; ip?: string }) => {
  const org: any = await Organization.findOne({ organizationId })
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (!org.isBlocked) throw new ApiError(httpStatus.CONFLICT, 'Organization is already active')
  const previous = org.platformAccess?.previousSubscriptionStatus
  const previousWebsiteStatus = org.platformAccess?.previousWebsiteStatus
  const fallback = org.subscription?.plan === 'trial' ? 'trialing' : 'active'
  let restored = previous && previous !== 'suspended' ? previous : fallback
  const now = new Date()
  const periodEnd = org.subscription?.currentPeriodEnd ? new Date(org.subscription.currentPeriodEnd) : null
  const graceEnd = org.subscription?.gracePeriodEnd ? new Date(org.subscription.gracePeriodEnd) : null
  if (periodEnd && periodEnd.getTime() <= now.getTime()) restored = graceEnd && graceEnd.getTime() > now.getTime() ? 'grace' : 'expired'
  org.isBlocked = false
  org.websiteStatus = previousWebsiteStatus && previousWebsiteStatus !== 'suspended' ? previousWebsiteStatus : 'published'
  org.platformAccess = { ...(org.platformAccess?.toObject?.() || org.platformAccess || {}), status: 'active', reactivatedAt: new Date(), reactivatedBy: actor.id, reactivationReason: actor.reason, suspensionSource: null, suspensionUserId: null }
  if (org.subscription) org.subscription.status = restored
  await org.save()
  await CacheInvalidationService.invalidateTenant(organizationId)
  await writeAudit({ organizationId, actorId: actor.id, actorRole: 'super-admin', action: 'organization.reactivated', entityType: 'organization', entityId: org._id.toString(), reason: actor.reason, requestId: actor.requestId, ip: actor.ip, metadata: { restoredSubscriptionStatus: restored, restoredWebsiteStatus: org.websiteStatus } })
  RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'updated', entityId: 'tenant_reactivated' })
  return org
}

const getPaymentLedger = async (query: any) => SubscriptionPaymentService.getPaymentLedger(query)

const recordManualPayment = async (input: any, actor: { id: string; requestId?: string; ip?: string }) => {
  const result = await SubscriptionPaymentService.recordPayment(input, actor)
  RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'created', entityId: String((result as any)?._id || (result as any)?.paymentNumber || 'payment') })
  return result
}

const decideManualPayment = async (paymentId: string, input: { status: 'confirmed' | 'rejected'; reason?: string }, actor: { id: string; requestId?: string; ip?: string }) => {
  const result = await SubscriptionPaymentService.decidePayment(paymentId, input, actor)
  RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'updated', entityId: paymentId })
  return result
}

const getRevenueDashboard = async () => SubscriptionPaymentService.getRevenueDashboard()

const getAuditLog = async (query: any) => {
  const page = Math.max(1, Number(query.page || 1))
  const limit = clampLimit(query.limit, 50)
  const filter: any = {}
  if (query.organizationId) filter.organizationId = query.organizationId
  if (query.action) filter.action = query.action
  if (query.actorId) filter.actorId = query.actorId
  if (query.entityType) filter.entityType = query.entityType
  if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lte: new Date(`${query.to}T23:59:59.999Z`) } : {}) }
  if (query.search) {
    const regex = safeRegex(String(query.search).trim())
    filter.$or = ['action', 'entityType', 'entityId', 'reason', 'organizationId', 'actorId'].map((field) => ({ [field]: { $regex: regex, $options: 'i' } }))
  }
  const [data, total] = await Promise.all([
    AuditEvent.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditEvent.countDocuments(filter),
  ])
  return { data, meta: { page, limit, total } }
}


const getSubscriptionSummary = async () => {
  const policy = await getTrialPolicy()
  const now = new Date()
  const expiringBefore = new Date(now.getTime() + policy.reminderDaysBeforeExpiry * 24 * 60 * 60 * 1000)
  const [totalAgencies, activeTrials, trialsExpiringSoon, pastDue, paidAgencies, planBreakdown] = await Promise.all([
    Organization.countDocuments({}),
    Organization.countDocuments({ isBlocked: { $ne: true }, 'subscription.status': 'trialing' }),
    Organization.countDocuments({ isBlocked: { $ne: true }, 'subscription.status': 'trialing', 'subscription.trialEndsAt': { $gt: now, $lte: expiringBefore } }),
    Organization.countDocuments({ isBlocked: { $ne: true }, 'subscription.status': { $in: ['past_due', 'grace', 'expired'] } }),
    Organization.countDocuments({ isBlocked: { $ne: true }, 'subscription.plan': { $ne: 'trial' }, 'subscription.status': { $in: ['active', 'grace', 'cancel_at_period_end'] } }),
    Organization.aggregate([{ $group: { _id: '$subscription.plan', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
  ])
  return { totalAgencies, activeTrials, trialsExpiringSoon, pastDue, paidAgencies, planBreakdown: planBreakdown.map((row: any) => ({ plan: row._id || 'unknown', count: row.count })), trialPolicy: toTeamMemberLimitContract(policy as any) }
}

const planForAdminAssignment = async (planId: string, version?: number) => {
  if (!['starter', 'professional', 'agency', 'enterprise'].includes(planId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Unsupported subscription plan')
  const query: any = { planId, isActive: true }
  if (version) query.version = version
  else query.isCurrent = true
  const plan: any = await SubscriptionPlan.findOne(query).lean()
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan version not found')
  return plan
}

const tenantUsage = async (organizationId: string) => {
  const [teamMembers, properties, leads] = await Promise.all([
    User.countDocuments({ organizationId, status: { $ne: 'blocked' }, userRole: { $in: ['agency_owner', 'agency_admin', 'agent', 'staff'] } }),
    Property.countDocuments({ organizationId, status: { $ne: 'Archived' } }),
    Lead.countDocuments({ organizationId, ...activePipelineLeadFilter() }),
  ])
  return { teamMembers, properties, leads }
}

const changeTenantSubscription = async (
  organizationId: string,
  input: { plan: 'trial' | 'starter' | 'professional' | 'agency' | 'enterprise'; planVersion?: number; reason: string; periodDays?: number },
  actor: { id: string; requestId?: string; ip?: string },
) => {
  const org: any = await Organization.findOne({ organizationId })
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (org.isBlocked) throw new ApiError(httpStatus.CONFLICT, 'Reactivate this tenant before changing its subscription')
  if (input.plan !== 'trial') throw new ApiError(httpStatus.CONFLICT, 'Paid plans are activated only by confirming a manual subscription payment. Record the payment instead.')
  const previous = org.subscription?.toObject?.() || { ...(org.subscription || {}) }
  const now = new Date()
  let assigned: any
  if (input.plan === 'trial') {
    const policy = await getTrialPolicy()
    if (!policy.enabled) throw new ApiError(httpStatus.CONFLICT, 'Trials are disabled in platform settings')
    const end = new Date(now.getTime() + Math.max(1, Number(input.periodDays || policy.defaultTrialDays)) * 24 * 60 * 60 * 1000)
    assigned = {
      plan: 'trial', planVersion: 1, status: 'trialing', currentPeriodEnd: end, trialEndsAt: end,
      gracePeriodEnd: null, cancelAtPeriodEnd: false, reminderSentAt: null, source: 'manual_admin',
      maxProperties: policy.maxProperties, maxAgents: policy.maxAgents,
    }
  } else {
    const plan: any = await planForAdminAssignment(input.plan, input.planVersion)
    const end = new Date(now.getTime() + Math.max(1, Number(input.periodDays || 30)) * 24 * 60 * 60 * 1000)
    assigned = {
      plan: plan.planId, planVersion: plan.version, status: 'active', currentPeriodEnd: end, trialEndsAt: null,
      gracePeriodEnd: null, cancelAtPeriodEnd: false, reminderSentAt: null, source: 'manual_admin',
      maxProperties: plan.maxProperties, maxAgents: plan.maxAgents,
    }
  }
  org.subscription = { ...(org.subscription?.toObject?.() || org.subscription || {}), ...assigned }
  await org.save()
  await CacheInvalidationService.invalidateTenant(organizationId)
  const usage = await tenantUsage(organizationId)
  const limits = input.plan === 'trial'
    ? { maxAgents: assigned.maxAgents, maxProperties: assigned.maxProperties, maxLeads: (await getTrialPolicy()).maxLeads }
    : await planForAdminAssignment(input.plan, assigned.planVersion)
  const warnings = [
    ...(usage.teamMembers > Number(limits.maxAgents || 0) ? [`Team usage (${usage.teamMembers}) is above this plan limit (${limits.maxAgents}). Existing users were preserved.`] : []),
    ...(usage.properties > Number(limits.maxProperties || 0) ? [`Property usage (${usage.properties}) is above this plan limit (${limits.maxProperties}). Existing listings were preserved.`] : []),
    ...(usage.leads > Number(limits.maxLeads || 0) ? [`Lead usage (${usage.leads}) is above this plan limit (${limits.maxLeads}). Existing leads were preserved.`] : []),
  ]
  await writeAudit({ organizationId, actorId: actor.id, actorRole: 'super-admin', action: 'subscription.plan_changed', entityType: 'organization', entityId: org._id.toString(), reason: input.reason, requestId: actor.requestId, ip: actor.ip, metadata: { previous, current: assigned, usage, warnings } })
  return { organizationId, agencyName: org.agencyName, subscription: org.subscription, usage, warnings }
}

const manageTenantTrial = async (
  organizationId: string,
  input: { action: 'extend' | 'set_end' | 'end' | 'restart'; days?: number; trialEndsAt?: string; reason: string },
  actor: { id: string; requestId?: string; ip?: string },
) => {
  const org: any = await Organization.findOne({ organizationId })
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (org.isBlocked) throw new ApiError(httpStatus.CONFLICT, 'Reactivate this tenant before changing its trial')
  if (org.subscription?.plan !== 'trial') throw new ApiError(httpStatus.CONFLICT, 'This agency is on a paid plan. Use Manage plan to switch it to Trial first.')
  const policy = await getTrialPolicy()
  const previous = org.subscription?.toObject?.() || { ...(org.subscription || {}) }
  const now = new Date()
  let end: Date = now
  if (input.action === 'extend') {
    const base = org.subscription?.trialEndsAt && new Date(org.subscription.trialEndsAt).getTime() > now.getTime() ? new Date(org.subscription.trialEndsAt) : now
    end = new Date(base.getTime() + Math.max(1, Number(input.days || 7)) * 24 * 60 * 60 * 1000)
  } else if (input.action === 'set_end') {
    if (!input.trialEndsAt) throw new ApiError(httpStatus.BAD_REQUEST, 'Trial end date is required')
    end = new Date(input.trialEndsAt)
    if (Number.isNaN(end.getTime()) || end <= now) throw new ApiError(httpStatus.BAD_REQUEST, 'Trial end date must be in the future')
  } else if (input.action === 'restart') {
    if (!policy.enabled) throw new ApiError(httpStatus.CONFLICT, 'Trials are disabled in platform settings')
    end = input.days ? new Date(now.getTime() + Math.max(1, Number(input.days)) * 24 * 60 * 60 * 1000) : trialEndFromPolicy(policy, now)
  }

  if (input.action === 'end') {
    org.subscription.status = 'expired'
    org.subscription.currentPeriodEnd = now
    org.subscription.trialEndsAt = now
  } else {
    org.subscription.plan = 'trial'
    org.subscription.planVersion = 1
    org.subscription.status = 'trialing'
    org.subscription.currentPeriodEnd = end
    org.subscription.trialEndsAt = end
    org.subscription.gracePeriodEnd = null
    org.subscription.cancelAtPeriodEnd = false
    org.subscription.reminderSentAt = null
    org.subscription.maxAgents = policy.maxAgents
    org.subscription.maxProperties = policy.maxProperties
    org.subscription.source = 'manual_admin'
  }
  await org.save()
  await CacheInvalidationService.invalidateTenant(organizationId)
  await writeAudit({ organizationId, actorId: actor.id, actorRole: 'super-admin', action: 'subscription.trial_updated', entityType: 'organization', entityId: org._id.toString(), reason: input.reason, requestId: actor.requestId, ip: actor.ip, metadata: { action: input.action, previous, current: org.subscription?.toObject?.() || org.subscription } })
  return { organizationId, agencyName: org.agencyName, subscription: org.subscription }
}

const searchPlatform = async (query: string) => {
  const q = String(query || '').trim().slice(0, 80)
  if (q.length < 2) return []
  const regex = new RegExp(safeRegex(q), 'i')
  const [organizations, users, payments] = await Promise.all([
    Organization.find({ $or: [{ agencyName: regex }, { organizationId: regex }, { email: regex }, { phone: regex }, { domain: regex }, { sub_domain: regex }] })
      .select('_id organizationId agencyName email subscription.plan isBlocked').sort({ updatedAt: -1 }).limit(6).lean(),
    User.find({ $or: [{ name: regex }, { email: regex }, { phoneNumber: regex }] })
      .select('_id name email phoneNumber userRole organizationId status').sort({ updatedAt: -1 }).limit(6).lean(),
    SubscriptionPayment.find({ $or: [{ paymentNumber: regex }, { receiptNumber: regex }, { reference: regex }, { organizationId: regex }] })
      .select('_id paymentNumber organizationId amount status method createdAt').sort({ createdAt: -1 }).limit(4).lean(),
  ])
  return [
    ...organizations.map((row:any) => ({ kind: 'organization', id: String(row._id), title: row.agencyName, subtitle: `${row.organizationId} · ${row.subscription?.plan || 'trial'}${row.isBlocked ? ' · suspended' : ''}`, href: `/dashboard/super-admin/organizations?search=${encodeURIComponent(row.organizationId)}` })),
    ...users.map((row:any) => ({ kind: 'user', id: String(row._id), title: row.name, subtitle: `${row.email} · ${String(row.userRole || '').replace(/_/g, ' ')}`, href: `/dashboard/super-admin/users?search=${encodeURIComponent(row.email || row.name)}` })),
    ...payments.map((row:any) => ({ kind: 'payment', id: String(row._id), title: row.paymentNumber, subtitle: `${row.organizationId} · ৳${Number(row.amount || 0).toLocaleString('en-BD')} · ${row.status}`, href: `/dashboard/super-admin/subscriptions?payment=${row._id}` })),
  ].slice(0, 16)
}

const getPlatformNotifications = async () => {
  const [pendingPayments, failedJobs, suspendedTenants, failedDomains] = await Promise.all([
    SubscriptionPayment.find({ status: 'pending' }).select('_id paymentNumber organizationId amount method createdAt').sort({ createdAt: -1 }).limit(6).lean(),
    OperationsJob.find({ status: 'failed' }).select('_id organizationId type entityId lastError updatedAt').sort({ updatedAt: -1 }).limit(6).lean(),
    Organization.find({ isBlocked: true }).select('_id organizationId agencyName platformAccess.suspensionReason updatedAt').sort({ updatedAt: -1 }).limit(4).lean(),
    DomainRecord.find({ $or: [{ status: 'failed' }, { tlsStatus: 'failed' }] }).select('_id organizationId domain status tlsStatus updatedAt').sort({ updatedAt: -1 }).limit(4).lean(),
  ])
  const items = [
    ...pendingPayments.map((row:any) => ({ id: `payment:${row._id}`, type: 'payment_pending', severity: 'warning', title: 'Payment needs review', body: `${row.paymentNumber} · ${row.organizationId} · ৳${Number(row.amount || 0).toLocaleString('en-BD')}`, href: '/dashboard/super-admin/subscriptions', createdAt: row.createdAt })),
    ...failedJobs.map((row:any) => ({ id: `job:${row._id}`, type: 'operation_failed', severity: 'danger', title: `${String(row.type).replace(/_/g, ' ')} failed`, body: `${row.organizationId}${row.lastError ? ` · ${String(row.lastError).slice(0, 140)}` : ''}`, href: `/dashboard/super-admin/organizations?search=${encodeURIComponent(row.organizationId)}`, createdAt: row.updatedAt })),
    ...failedDomains.map((row:any) => ({ id: `domain:${row._id}`, type: 'domain_failed', severity: 'danger', title: 'Domain/TLS needs attention', body: `${row.domain || row.organizationId} · ${row.status}/${row.tlsStatus}`, href: `/dashboard/super-admin/organizations?search=${encodeURIComponent(row.organizationId)}`, createdAt: row.updatedAt })),
    ...suspendedTenants.map((row:any) => ({ id: `tenant:${row._id}`, type: 'tenant_suspended', severity: 'info', title: 'Tenant is suspended', body: `${row.agencyName} · ${row.organizationId}`, href: `/dashboard/super-admin/organizations?search=${encodeURIComponent(row.organizationId)}`, createdAt: row.updatedAt })),
  ]
  return items.sort((a:any,b:any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).slice(0, 20)
}

const startImpersonation = async (input: { adminUserId: string; organizationId: string; targetUserId?: string; reason: string; durationMinutes?: number; requestId?: string; ip?: string; userAgent?: string }) => {
  const durationMinutes = Math.min(30, Math.max(5, Number(input.durationMinutes || 15)))
  const organization = await Organization.findOne({ organizationId: input.organizationId }).select('organizationId agencyName isBlocked platformAccess.status').lean()
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (organization.isBlocked || organization.platformAccess?.status === 'suspended') throw new ApiError(httpStatus.CONFLICT, 'Suspended agencies cannot be opened in support mode. Reactivate the agency first.')
  const existing = await ImpersonationSession.findOne({ adminUserId: input.adminUserId, endedAt: null, expiresAt: { $gt: new Date() } }).select('_id organizationId expiresAt').lean()
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'End your current support impersonation session before opening another agency.')
  const userFilter: any = { organizationId: input.organizationId, status: 'active', isVerified: true, userRole: { $in: ['agency_owner', 'agency_admin'] } }
  if (input.targetUserId) {
    if (!mongoose.isValidObjectId(input.targetUserId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid target user')
    userFilter._id = input.targetUserId
  }
  const target = await User.findOne(userFilter).sort({ userRole: 1, createdAt: 1 }).select('_id name email phoneNumber userRole organizationId').lean()
  if (!target) throw new ApiError(httpStatus.NOT_FOUND, 'No active verified tenant administrator is available for support impersonation')
  const expiresAt = new Date(Date.now() + durationMinutes * 60_000)
  const session = await ImpersonationSession.create({ adminUserId: input.adminUserId, targetUserId: target._id, organizationId: input.organizationId, reason: input.reason, readOnly: true, expiresAt, requestId: input.requestId || '', ip: input.ip || '', userAgent: input.userAgent || '' })
  const token = jwtHelpers.createToken({ typ: 'support_impersonation', impersonationSessionId: session._id.toString(), supportAdminId: input.adminUserId, _id: target._id.toString(), organizationId: input.organizationId, userRole: target.userRole, readOnly: true }, config.jwt.secret as Secret, `${durationMinutes}m`)
  await writeAudit({ organizationId: input.organizationId, actorId: input.adminUserId, actorRole: 'super-admin', action: 'impersonation.started', entityType: 'impersonationSession', entityId: session._id.toString(), reason: input.reason, requestId: input.requestId, ip: input.ip, metadata: { targetUserId: target._id.toString(), readOnly: true, expiresAt } })
  return { token, session: { id: session._id.toString(), organizationId: input.organizationId, agencyName: organization.agencyName, targetUser: { _id: target._id, name: target.name, email: target.email, userRole: target.userRole }, readOnly: true, expiresAt, reason: input.reason } }
}

const verifyImpersonationToken = async (token: string) => {
  let payload: any
  try { payload = jwtHelpers.verifyToken(token, config.jwt.secret as Secret) } catch { throw new ApiError(401, 'Support impersonation session expired') }
  if (payload.typ !== 'support_impersonation' || !payload.impersonationSessionId || !payload.supportAdminId) throw new ApiError(401, 'Invalid support impersonation token')
  const session: any = await ImpersonationSession.findOne({ _id: payload.impersonationSessionId, endedAt: null, expiresAt: { $gt: new Date() } }).lean()
  if (!session || session.adminUserId.toString() !== String(payload.supportAdminId) || session.targetUserId.toString() !== String(payload._id)) throw new ApiError(401, 'Support impersonation session is no longer active')
  return { payload, session }
}

const currentImpersonation = async (token: string) => {
  const { payload, session } = await verifyImpersonationToken(token)
  const [organization, target] = await Promise.all([
    Organization.findOne({ organizationId: session.organizationId }).select('organizationId agencyName isBlocked platformAccess.status').lean(),
    User.findById(session.targetUserId).select('_id name email userRole organizationId status').lean(),
  ])
  if (!organization || organization.isBlocked || organization.platformAccess?.status === 'suspended' || !target || target.status !== 'active') throw new ApiError(401, 'Support impersonation target is no longer available')
  return {
    id: String(session._id), organizationId: session.organizationId, agencyName: organization.agencyName,
    targetUser: { _id: target._id, name: target.name, email: target.email, userRole: target.userRole },
    supportAdminId: String(payload.supportAdminId), readOnly: true, expiresAt: session.expiresAt, reason: session.reason,
  }
}

const endImpersonation = async (token: string, _actorId?: string, requestId?: string, ip?: string) => {
  const { payload, session } = await verifyImpersonationToken(token)
  await ImpersonationSession.updateOne({ _id: session._id, endedAt: null }, { $set: { endedAt: new Date(), endedBy: payload.supportAdminId } })
  await writeAudit({ organizationId: session.organizationId, actorId: payload.supportAdminId, actorRole: 'super-admin', action: 'impersonation.ended', entityType: 'impersonationSession', entityId: session._id.toString(), reason: 'Support impersonation session ended', requestId, ip, metadata: { targetUserId: session.targetUserId.toString(), readOnly: true } })
  return { ended: true }
}

export const PlatformAdminService = { getTenantHealth, suspendTenant, reactivateTenant, getPaymentLedger, recordManualPayment, decideManualPayment, getRevenueDashboard, getAuditLog, getSubscriptionSummary, changeTenantSubscription, manageTenantTrial, searchPlatform, getPlatformNotifications, startImpersonation, verifyImpersonationToken, currentImpersonation, endImpersonation }
