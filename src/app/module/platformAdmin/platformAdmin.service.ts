import { Secret } from 'jsonwebtoken'
import httpStatus from 'http-status'
import mongoose from 'mongoose'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { jwtHelpers } from '../../helpers/jwtHelpers'
import { AuditEvent } from '../audit/audit.model'
import { writeAudit } from '../audit/audit.service'
import { Billing } from '../billing/billing.model'
import { BkashPayment } from '../bkashPayment/bkashPayment.model'
import { DomainRecord } from '../domain/domain.model'
import { DomainEvent } from '../domainEvent/domainEvent.model'
import { Lead } from '../lead/lead.model'
import { MetaEvent } from '../metaIntegration/metaEvent.model'
import { OperationsJob } from '../operationsQueue/operationsJob.model'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { SupportTicket } from '../support/support.model'
import { User } from '../user/user.model'
import { ImpersonationSession } from './impersonationSession.model'
import { AuthSession } from '../auth/authSession.model'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { getTrialPolicy, trialEndFromPolicy } from '../platformSettings/trialPolicy.service'

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
  const limit = clampLimit(query.limit)
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
    Organization.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Organization.countDocuments(filter),
  ])
  const ids = organizations.map((org: any) => org.organizationId)
  if (!ids.length) return { data: [], meta: { page, limit, total } }

  const [properties, agents, leads, domains, latestEvents, latestPayments, failedJobs, deadMeta, openSupport, breachedSupport] = await Promise.all([
    groupCounts(Property, ids, { status: { $ne: 'Archived' } }),
    groupCounts(User, ids, { userRole: { $in: ['agency_owner', 'agency_admin', 'agent', 'staff'] }, status: { $ne: 'blocked' } }),
    groupCounts(Lead, ids, { leadStatus: { $nin: ['Won', 'Lost'] } }),
    DomainRecord.find({ organizationId: { $in: ids } }).select('organizationId domain status tlsStatus lastCheckedAt diagnostics').lean(),
    DomainEvent.aggregate([{ $match: { organizationId: { $in: ids } } }, { $sort: { occurredAt: -1 } }, { $group: { _id: '$organizationId', at: { $first: '$occurredAt' }, type: { $first: '$eventType' } } }]),
    BkashPayment.aggregate([{ $match: { organizationId: { $in: ids } } }, { $sort: { createdAt: -1 } }, { $group: { _id: '$organizationId', payment: { $first: '$$ROOT' } } }]),
    groupCounts(OperationsJob, ids, { status: 'failed' }),
    groupCounts(MetaEvent, ids, { status: 'dead' }),
    groupCounts(SupportTicket, ids, { status: { $in: ['open', 'in_progress'] } }),
    groupCounts(SupportTicket, ids, { status: { $in: ['open', 'in_progress'] }, slaBreachedAt: { $ne: null } }),
  ])
  const domainMap = new Map(domains.map((row: any) => [row.organizationId, row]))
  const eventMap = new Map(latestEvents.map((row: any) => [String(row._id), row]))
  const paymentMap = new Map(latestPayments.map((row: any) => [String(row._id), row.payment]))

  const data = organizations.map((org: any) => {
    const domain: any = domainMap.get(org.organizationId)
    const payment: any = paymentMap.get(org.organizationId)
    const errorCount = Number(failedJobs.get(org.organizationId) || 0) + Number(deadMeta.get(org.organizationId) || 0) + (domain?.status === 'failed' || domain?.tlsStatus === 'failed' ? 1 : 0)
    const slaBreaches = Number(breachedSupport.get(org.organizationId) || 0)
    const health = org.isBlocked ? 'suspended' : (errorCount > 0 || slaBreaches > 0 || ['past_due', 'expired'].includes(org.subscription?.status) || ['failed', 'cancelled'].includes(payment?.status)) ? 'attention' : 'healthy'
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
      paymentState: payment?.status || (org.subscription?.plan === 'trial' ? 'trial' : 'none'),
      paymentId: payment?.paymentId || '',
      subscriptionStatus: org.subscription?.status || 'trialing',
      currentPeriodEnd: org.subscription?.currentPeriodEnd,
      trialEndsAt: org.subscription?.trialEndsAt,
      subscriptionSource: org.subscription?.source || 'trial',
      usage: {
        properties: properties.get(org.organizationId) || 0,
        agents: agents.get(org.organizationId) || 0,
        leads: leads.get(org.organizationId) || 0,
        storageUsedBytes: org.storageUsedBytes || 0,
        monthlyVisitors: org.monthlyVisitorCount || 0,
      },
      domain: domain ? { host: domain.domain, status: domain.status, tlsStatus: domain.tlsStatus, lastCheckedAt: domain.lastCheckedAt } : null,
      lastActivity: eventMap.get(org.organizationId) || { at: org.updatedAt, type: 'organization.updated' },
      errors: errorCount,
      support: { openTickets: openSupport.get(org.organizationId) || 0, slaBreaches },
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
  return org
}

const getPaymentLedger = async (query: any) => {
  const page = Math.max(1, Number(query.page || 1))
  const limit = clampLimit(query.limit, 50)
  const filter: any = {}
  if (query.status) filter.status = query.status
  if (query.organizationId) filter.organizationId = query.organizationId
  if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lte: new Date(`${query.to}T23:59:59.999Z`) } : {}) }
  if (query.search) {
    const regex = safeRegex(String(query.search).trim())
    filter.$or = ['paymentId', 'transactionId', 'invoiceNumber', 'organizationId'].map((field) => ({ [field]: { $regex: regex, $options: 'i' } }))
  }
  const [rows, total, statusSummary] = await Promise.all([
    BkashPayment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    BkashPayment.countDocuments(filter),
    BkashPayment.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
  ])
  const orgIds = [...new Set(rows.map((row: any) => row.organizationId))]
  const orgs = await Organization.find({ organizationId: { $in: orgIds } }).select('organizationId agencyName email').lean()
  const orgMap = new Map(orgs.map((org: any) => [org.organizationId, org]))
  return { data: rows.map((row: any) => ({ ...row, organization: orgMap.get(row.organizationId) || null })), meta: { page, limit, total }, summary: statusSummary }
}

const addPaymentNote = async (paymentId: string, note: string, actor: { id: string; requestId?: string; ip?: string }) => {
  const payment = await BkashPayment.findOneAndUpdate(
    { paymentId },
    { $push: { reconciliationNotes: { $each: [{ authorId: actor.id, note, createdAt: new Date() }], $slice: -20 } } },
    { new: true },
  )
  if (!payment) throw new ApiError(httpStatus.NOT_FOUND, 'Payment attempt not found')
  await writeAudit({ organizationId: payment.organizationId, actorId: actor.id, actorRole: 'super-admin', action: 'payment.reconciliation_note_added', entityType: 'bkashPayment', entityId: paymentId, reason: note, requestId: actor.requestId, ip: actor.ip })
  return payment
}

const getRevenueDashboard = async () => {
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1))
  const activeSubscriptionFilter = { isBlocked: { $ne: true }, 'subscription.status': { $in: ['active', 'trialing', 'grace', 'cancel_at_period_end'] } }
  const [totals, currentMonth, latestPaidByOrg, trend, paymentStatus, activeOrganizations] = await Promise.all([
    Billing.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, revenue: { $sum: '$amount' }, invoices: { $sum: 1 } } }]),
    Billing.aggregate([{ $match: { status: 'paid', createdAt: { $gte: monthStart } } }, { $group: { _id: null, revenue: { $sum: '$amount' }, invoices: { $sum: 1 } } }]),
    Billing.aggregate([{ $match: { status: 'paid', serviceType: 'subscription' } }, { $sort: { createdAt: -1 } }, { $group: { _id: '$organizationId', amount: { $first: '$amount' }, billingCycle: { $first: '$billingCycle' }, createdAt: { $first: '$createdAt' } } }]),
    Billing.aggregate([{ $match: { status: 'paid', createdAt: { $gte: sixMonthsAgo } } }, { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, revenue: { $sum: '$amount' }, invoices: { $sum: 1 } } }, { $sort: { '_id.year': 1, '_id.month': 1 } }]),
    BkashPayment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
    Organization.find(activeSubscriptionFilter).select('organizationId').lean(),
  ])
  const activeIds = new Set(activeOrganizations.map((org: any) => org.organizationId))
  const mrr = latestPaidByOrg.reduce((sum: number, item: any) => activeIds.has(String(item._id)) ? sum + (item.billingCycle === 'yearly' ? Number(item.amount || 0) / 12 : item.billingCycle === 'monthly' ? Number(item.amount || 0) : 0) : sum, 0)
  const activeSubscriptions = activeOrganizations.length
  return {
    totalRevenue: totals[0]?.revenue || 0,
    paidInvoices: totals[0]?.invoices || 0,
    monthRevenue: currentMonth[0]?.revenue || 0,
    monthInvoices: currentMonth[0]?.invoices || 0,
    mrr: Number(mrr.toFixed(2)),
    activeSubscriptions,
    arpu: activeSubscriptions ? Number((mrr / activeSubscriptions).toFixed(2)) : 0,
    trend: trend.map((row: any) => ({ year: row._id.year, month: row._id.month, revenue: row.revenue, invoices: row.invoices })),
    paymentStatus,
  }
}

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
  return { totalAgencies, activeTrials, trialsExpiringSoon, pastDue, paidAgencies, planBreakdown: planBreakdown.map((row: any) => ({ plan: row._id || 'unknown', count: row.count })), trialPolicy: policy }
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
  const [agents, properties, leads] = await Promise.all([
    User.countDocuments({ organizationId, status: { $ne: 'blocked' }, userRole: { $in: ['agency_owner', 'agency_admin', 'agent', 'staff'] } }),
    Property.countDocuments({ organizationId, status: { $ne: 'Archived' } }),
    Lead.countDocuments({ organizationId, leadStatus: { $nin: ['Won', 'Lost'] } }),
  ])
  return { agents, properties, leads }
}

const changeTenantSubscription = async (
  organizationId: string,
  input: { plan: 'trial' | 'starter' | 'professional' | 'agency' | 'enterprise'; planVersion?: number; reason: string; periodDays?: number },
  actor: { id: string; requestId?: string; ip?: string },
) => {
  const org: any = await Organization.findOne({ organizationId })
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  if (org.isBlocked) throw new ApiError(httpStatus.CONFLICT, 'Reactivate this tenant before changing its subscription')
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
    ...(usage.agents > Number(limits.maxAgents || 0) ? [`Team usage (${usage.agents}) is above this plan limit (${limits.maxAgents}). Existing users were preserved.`] : []),
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

const startImpersonation = async (input: { adminUserId: string; organizationId: string; targetUserId?: string; reason: string; durationMinutes?: number; requestId?: string; ip?: string; userAgent?: string }) => {
  const durationMinutes = Math.min(30, Math.max(5, Number(input.durationMinutes || 15)))
  const organization = await Organization.findOne({ organizationId: input.organizationId }).select('organizationId agencyName isBlocked').lean()
  if (!organization) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  const userFilter: any = { organizationId: input.organizationId, status: 'active', isVerified: true }
  if (input.targetUserId) {
    if (!mongoose.isValidObjectId(input.targetUserId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid target user')
    userFilter._id = input.targetUserId
  } else userFilter.userRole = { $in: ['agency_owner', 'agency_admin'] }
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

const endImpersonation = async (token: string, actorId?: string, requestId?: string, ip?: string) => {
  const { payload, session } = await verifyImpersonationToken(token)
  await ImpersonationSession.updateOne({ _id: session._id, endedAt: null }, { $set: { endedAt: new Date(), endedBy: actorId || payload.supportAdminId } })
  await writeAudit({ organizationId: session.organizationId, actorId: payload.supportAdminId, actorRole: 'super-admin', action: 'impersonation.ended', entityType: 'impersonationSession', entityId: session._id.toString(), reason: 'Support impersonation session ended', requestId, ip, metadata: { targetUserId: session.targetUserId.toString(), readOnly: true } })
  return { ended: true }
}

export const PlatformAdminService = { getTenantHealth, suspendTenant, reactivateTenant, getPaymentLedger, addPaymentNote, getRevenueDashboard, getAuditLog, getSubscriptionSummary, changeTenantSubscription, manageTenantTrial, startImpersonation, verifyImpersonationToken, endImpersonation }
