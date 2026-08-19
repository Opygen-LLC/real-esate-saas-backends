import mongoose, { type ClientSession } from 'mongoose'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { buildTeamMemberQuotaContract } from '../../../contracts/workspaceContracts'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { Lead } from '../lead/lead.model'
import { activePipelineLeadFilter } from '../lead/leadStatus.contract'
import { Organization } from '../organization/organization.model'
import { getTrialPolicy } from '../platformSettings/trialPolicy.service'
import { Property } from '../property/property.model'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { TeamInvitation } from '../teamInvitation/teamInvitation.model'
import { User } from '../user/user.model'

type Feature = 'customDomain' | 'advancedAnalytics' | 'whatsAppAutomation' | 'smsAutomation' | 'premiumTemplates' | 'leadAutomations'
export type LimitedResource = 'properties' | 'teamMembers' | 'leads'

export const TEAM_MEMBER_SEAT_ROLES = ['agency_owner', 'agency_admin', 'agent', 'staff', 'viewer'] as const

const activePlanFilter = () => ({
  isActive: true,
  effectiveFrom: { $lte: new Date() },
  $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: new Date() } }],
})

const withSession = <T extends { session: (session: ClientSession) => T }>(query: T, session?: ClientSession): T => {
  if (session) query.session(session)
  return query
}

const trialLimits = async () => {
  const policy = await getTrialPolicy()
  return {
    maxTeamMembers: Number(policy.maxAgents || 0),
    maxProperties: policy.maxProperties,
    maxLeads: policy.maxLeads,
    maxStorageMb: policy.maxStorageMb,
    maxMonthlyVisitors: policy.maxMonthlyVisitors,
    hasCustomDomain: policy.hasCustomDomain,
    hasAdvancedAnalytics: policy.hasAdvancedAnalytics,
    hasWhatsAppIntegration: policy.hasWhatsAppIntegration,
    hasSmsAutomation: policy.hasSmsAutomation,
    hasPremiumTemplates: policy.hasPremiumTemplates,
    hasLeadAutomations: policy.hasLeadAutomations,
  }
}

export const trialEntitlements = {
  maxTeamMembers: 2,
  maxProperties: 10,
  maxLeads: 100,
  maxStorageMb: 512,
  maxMonthlyVisitors: 5000,
  hasCustomDomain: false,
  hasAdvancedAnalytics: false,
  hasWhatsAppIntegration: false,
  hasSmsAutomation: false,
  hasPremiumTemplates: false,
  hasLeadAutomations: false,
}

const resolve = async (organizationId: string, session?: ClientSession) => {
  const organization = await withSession(Organization.findOne({ organizationId }), session)
  if (!organization || organization.isBlocked) throw new ApiError(403, 'Organization is unavailable')
  if (!['trialing', 'active', 'grace', 'cancel_at_period_end'].includes(organization.subscription.status)) {
    throw new ApiError(
      402,
      `Subscription is ${organization.subscription.status}. Choose an active plan to continue.`,
      '',
      'SUBSCRIPTION_INACTIVE',
      { currentPlan: organization.subscription.plan, subscriptionStatus: organization.subscription.status },
    )
  }

  const baseTrial = await trialLimits()
  let plan = null as any
  if (organization.subscription.plan !== 'trial') {
    let exactVersion = null as any
    if (organization.subscription.planVersion) {
      const exactQuery = SubscriptionPlan.findOne({ planId: organization.subscription.plan, version: organization.subscription.planVersion })
      exactVersion = await withSession(exactQuery, session).lean()
    }
    if (exactVersion) plan = exactVersion
    else {
      const currentPlanQuery = SubscriptionPlan.findOne({
        planId: organization.subscription.plan,
        ...activePlanFilter(),
      }).sort({ version: -1 })
      plan = await withSession(currentPlanQuery, session).lean()
    }
  }

  const { maxAgents: persistedPlanTeamLimit, ...canonicalPlan } = plan || {}
  return {
    organization,
    limits: {
      ...baseTrial,
      ...canonicalPlan,
      maxTeamMembers: Number(organization.subscription.maxAgents ?? persistedPlanTeamLimit ?? baseTrial.maxTeamMembers),
      maxProperties: Number(organization.subscription.maxProperties ?? plan?.maxProperties ?? baseTrial.maxProperties),
      maxLeads: Number(plan?.maxLeads ?? baseTrial.maxLeads),
    },
  }
}

export const wouldExceedEntitlementLimit = (usage: number, maximum: number, increment = 1): boolean => usage + increment > maximum

const recommendPlanForFeature = async (feature: Feature): Promise<string | null> => {
  const field = {
    customDomain: 'hasCustomDomain',
    advancedAnalytics: 'hasAdvancedAnalytics',
    whatsAppAutomation: 'hasWhatsAppIntegration',
    smsAutomation: 'hasSmsAutomation',
    premiumTemplates: 'hasPremiumTemplates',
    leadAutomations: 'hasLeadAutomations',
  }[feature]
  const plan = await SubscriptionPlan.findOne({ ...activePlanFilter(), [field]: true }).sort({ priceMonthly: 1, version: -1 }).select('planId').lean()
  return plan?.planId || null
}

const recommendPlanForLimit = async (resource: LimitedResource, required: number): Promise<string | null> => {
  // maxAgents remains the persistence field until the dedicated plan migration runs.
  const field = resource === 'properties' ? 'maxProperties' : resource === 'teamMembers' ? 'maxAgents' : 'maxLeads'
  const plan = await SubscriptionPlan.findOne({ ...activePlanFilter(), [field]: { $gte: required } }).sort({ priceMonthly: 1, version: -1 }).select('planId').lean()
  return plan?.planId || null
}

const countLimitedResourceUsage = async (organizationId: string, resource: LimitedResource, session?: ClientSession): Promise<number> => {
  if (resource === 'properties') {
    return withSession(Property.countDocuments({ organizationId, status: { $ne: 'Archived' } }), session)
  }
  if (resource === 'teamMembers') {
    return withSession(User.countDocuments({
      organizationId,
      status: { $ne: 'blocked' },
      userRole: { $in: TEAM_MEMBER_SEAT_ROLES },
    }), session)
  }
  return withSession(Lead.countDocuments({ organizationId, ...activePipelineLeadFilter() }), session)
}

const countReservedTeamMembers = async (organizationId: string, session?: ClientSession): Promise<number> => withSession(
  TeamInvitation.countDocuments({ organizationId, status: 'pending', expiresAt: { $gt: new Date() } }),
  session,
)

const getTeamMemberQuotaSnapshot = async (organizationId: string, session?: ClientSession, resolvedInput?: Awaited<ReturnType<typeof resolve>>) => {
  const resolved = resolvedInput || await resolve(organizationId, session)
  const [teamMembersUsed, teamMembersReserved] = await Promise.all([
    countLimitedResourceUsage(organizationId, 'teamMembers', session),
    countReservedTeamMembers(organizationId, session),
  ])
  return buildTeamMemberQuotaContract(Number(resolved.limits.maxTeamMembers || 0), teamMembersUsed, teamMembersReserved)
}

const getUsageSnapshot = async (organizationId: string) => {
  const resolved = await resolve(organizationId)
  const [properties, teamMembersUsed, teamMembersReserved, leads] = await Promise.all([
    countLimitedResourceUsage(organizationId, 'properties'),
    countLimitedResourceUsage(organizationId, 'teamMembers'),
    countReservedTeamMembers(organizationId),
    countLimitedResourceUsage(organizationId, 'leads'),
  ])
  const teamMemberQuota = buildTeamMemberQuotaContract(
    Number(resolved.limits.maxTeamMembers || 0),
    teamMembersUsed,
    teamMembersReserved,
  )
  return { ...resolved, usage: { properties, teamMembers: teamMembersUsed, leads }, teamMemberQuota }
}

const assertTeamMemberCapacity = async (
  organizationId: string,
  options: { additionalCommitments?: number; session?: ClientSession } = {},
): Promise<void> => {
  const additionalCommitments = Math.max(0, Number(options.additionalCommitments || 0))
  const resolved = await resolve(organizationId, options.session)
  const quota = await getTeamMemberQuotaSnapshot(organizationId, options.session, resolved)
  const requiredCommitted = quota.teamMembersCommitted + additionalCommitments

  if (requiredCommitted > quota.maxTeamMembers) {
    const recommendedPlan = await recommendPlanForLimit('teamMembers', requiredCommitted)
    throw new ApiError(
      402,
      `Team member limit reached (${quota.teamMembersCommitted}/${quota.maxTeamMembers}). Existing members were preserved.`,
      '',
      'PLAN_LIMIT_REACHED',
      {
        resource: 'teamMembers',
        maxTeamMembers: quota.maxTeamMembers,
        teamMembersUsed: quota.teamMembersUsed,
        teamMembersReserved: quota.teamMembersReserved,
        teamMembersCommitted: quota.teamMembersCommitted,
        teamMembersAvailable: quota.teamMembersAvailable,
        teamMembersOverCapacityBy: quota.teamMembersOverCapacityBy,
        requestedIncrement: additionalCommitments,
        currentPlan: resolved.organization.subscription.plan,
        recommendedPlan,
      },
    )
  }
}

const assertLimit = async (organizationId: string, resource: LimitedResource, increment = 1, session?: ClientSession): Promise<void> => {
  if (resource === 'teamMembers') {
    await assertTeamMemberCapacity(organizationId, { additionalCommitments: increment, session })
    return
  }

  const { organization, limits } = await resolve(organizationId, session)
  const usage = await countLimitedResourceUsage(organizationId, resource, session)
  const maximum = resource === 'properties' ? limits.maxProperties : limits.maxLeads

  if (wouldExceedEntitlementLimit(usage, maximum, increment)) {
    const recommendedPlan = await recommendPlanForLimit(resource, usage + increment)
    throw new ApiError(
      402,
      `${resource} limit reached (${usage}/${maximum}). Existing data was not removed.`,
      '',
      'PLAN_LIMIT_REACHED',
      { resource, used: usage, limit: maximum, requestedIncrement: increment, currentPlan: organization.subscription.plan, recommendedPlan },
    )
  }
}

const localTeamQuotaLocks = new Map<string, Promise<void>>()

const withLocalTeamQuotaLock = async <T>(organizationId: string, work: (session?: ClientSession) => Promise<T>): Promise<T> => {
  const previous = localTeamQuotaLocks.get(organizationId) || Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => { release = resolveGate })
  const chain = previous.then(() => gate)
  localTeamQuotaLocks.set(organizationId, chain)
  await previous
  try {
    return await work(undefined)
  } finally {
    release()
    if (localTeamQuotaLocks.get(organizationId) === chain) localTeamQuotaLocks.delete(organizationId)
  }
}

const withTeamMemberQuotaGuard = async <T>(organizationId: string, work: (session?: ClientSession) => Promise<T>): Promise<T> => {
  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try {
      let value: T | undefined
      await session.withTransaction(async () => {
        // All quota-sensitive writes touch the same tenant document first. This
        // deliberately creates a transaction write-conflict so concurrent invite
        // and direct-user requests are retried against a fresh quota snapshot.
        const lock = await Organization.updateOne(
          { organizationId },
          { $inc: { teamQuotaRevision: 1 } },
          { session },
        )
        if (!lock.matchedCount) throw new ApiError(404, 'Organization not found')
        value = await work(session)
      })
      if (value === undefined) throw new ApiError(500, 'Team quota transaction did not complete')
      return value
    } finally {
      await session.endSession()
    }
  }

  if (config.env === 'production') {
    throw new ApiError(503, 'Team member quota changes require a MongoDB replica set or mongos in production')
  }
  return withLocalTeamQuotaLock(organizationId, work)
}

export const featureEnabled = (limits: Record<string, any>, feature: Feature): boolean => {
  const mapping: Record<Feature, boolean> = {
    customDomain: Boolean(limits.hasCustomDomain),
    advancedAnalytics: Boolean(limits.hasAdvancedAnalytics),
    whatsAppAutomation: Boolean(limits.hasWhatsAppIntegration),
    smsAutomation: Boolean(limits.hasSmsAutomation),
    premiumTemplates: Boolean(limits.hasPremiumTemplates),
    leadAutomations: Boolean(limits.hasLeadAutomations),
  }
  return mapping[feature]
}

const hasFeature = async (organizationId: string, feature: Feature): Promise<boolean> => {
  const { limits } = await resolve(organizationId)
  return featureEnabled(limits, feature)
}

const assertFeature = async (organizationId: string, feature: Feature): Promise<void> => {
  const { organization, limits } = await resolve(organizationId)
  if (!featureEnabled(limits, feature)) {
    const recommendedPlan = await recommendPlanForFeature(feature)
    throw new ApiError(
      402,
      `${feature} is not included in the current plan`,
      '',
      'PLAN_UPGRADE_REQUIRED',
      { feature, currentPlan: organization.subscription.plan, recommendedPlan },
    )
  }
}

const assertStorage = async (organizationId: string, additionalBytes: number): Promise<void> => {
  const { organization, limits } = await resolve(organizationId)
  const usedBytes = organization.storageUsedBytes || 0
  const limitBytes = limits.maxStorageMb * 1024 * 1024
  if (usedBytes + additionalBytes > limitBytes) {
    const plans = await SubscriptionPlan.find({ ...activePlanFilter(), maxStorageMb: { $gte: Math.ceil((usedBytes + additionalBytes) / 1024 / 1024) } }).sort({ priceMonthly: 1, version: -1 }).select('planId').lean()
    throw new ApiError(402, 'Storage quota exceeded', '', 'PLAN_LIMIT_REACHED', {
      resource: 'storage', used: usedBytes, limit: limitBytes, requestedIncrement: additionalBytes,
      currentPlan: organization.subscription.plan, recommendedPlan: plans[0]?.planId || null,
    })
  }
}

const consumeVisitor = async (organizationId: string): Promise<void> => {
  const { organization, limits } = await resolve(organizationId)
  const month = new Date().toISOString().slice(0, 7)
  const monthReset = organization.visitorUsageMonth !== month
  if (monthReset) {
    await Organization.updateOne({ organizationId }, { visitorUsageMonth: month, monthlyVisitorCount: 0 })
  }
  const updated = await Organization.findOneAndUpdate(
    { organizationId, monthlyVisitorCount: { $lt: limits.maxMonthlyVisitors } },
    { $inc: { monthlyVisitorCount: 1, totalVisitor: 1 } },
    { new: true },
  )
  if (!updated) {
    const used = monthReset ? 0 : (organization.monthlyVisitorCount || limits.maxMonthlyVisitors)
    const plan = await SubscriptionPlan.findOne({
      ...activePlanFilter(),
      maxMonthlyVisitors: { $gte: used + 1 },
    }).sort({ priceMonthly: 1, version: -1 }).select('planId').lean()
    throw new ApiError(402, 'Monthly visitor quota reached', '', 'PLAN_LIMIT_REACHED', {
      resource: 'monthlyVisitors',
      used,
      limit: limits.maxMonthlyVisitors,
      requestedIncrement: 1,
      currentPlan: organization.subscription.plan,
      recommendedPlan: plan?.planId || null,
    })
  }
}

export const EntitlementService = {
  resolve,
  getUsageSnapshot,
  getTeamMemberQuotaSnapshot,
  assertLimit,
  assertTeamMemberCapacity,
  withTeamMemberQuotaGuard,
  assertFeature,
  hasFeature,
  assertStorage,
  consumeVisitor,
}
