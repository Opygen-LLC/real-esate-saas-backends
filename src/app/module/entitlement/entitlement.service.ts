import { randomUUID } from 'crypto'
import mongoose, { type ClientSession } from 'mongoose'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { buildTeamMemberQuotaContract } from '../../../contracts/workspaceContracts'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { Lead } from '../lead/lead.model'
import { SubscriptionBenefitPeriod } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.model'
import { LeadAllowanceReservation } from './leadAllowanceReservation.model'
import type { LeadAllowanceSource } from './leadAllowanceReservation.interface'
import { activePipelineLeadFilter } from '../lead/leadStatus.contract'
import { Organization } from '../organization/organization.model'
import { getTrialPolicy } from '../platformSettings/trialPolicy.service'
import { Property } from '../property/property.model'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { TeamInvitation } from '../teamInvitation/teamInvitation.model'
import { User } from '../user/user.model'
import { TEAM_MEMBER_SEAT_ROLES } from './teamSeat.contract'

type Feature = 'customDomain' | 'advancedAnalytics' | 'whatsAppAutomation' | 'smsAutomation' | 'premiumTemplates' | 'leadAutomations'
export type LimitedResource = 'properties' | 'teamMembers' | 'leads'

export const PROPERTY_NON_CONSUMING_STATUSES = ['Sold', 'Rented', 'OffMarket'] as const
export const propertyCountsTowardQuotaFilter = () => ({
  quotaLocked: { $ne: true },
  status: { $nin: [...PROPERTY_NON_CONSUMING_STATUSES] },
})

export { TEAM_MEMBER_SEAT_ROLES } from './teamSeat.contract'

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
  let organization = await withSession(Organization.findOne({ organizationId }), session)
  if (!organization || organization.isBlocked) throw new ApiError(403, 'Organization is unavailable')

  // The worker is the normal path, but entitlement reads are the authoritative boundary guard:
  // a request arriving at/after scheduledEffectiveAt must never observe the old plan limits.
  if (!session
    && organization.subscription?.scheduledPlan
    && organization.subscription?.scheduledEffectiveAt
    && new Date(organization.subscription.scheduledEffectiveAt).getTime() <= Date.now()) {
    const { SubscriptionScheduleService } = await import('../subscription/subscriptionSchedule.service')
    await SubscriptionScheduleService.applyDueChange(organizationId, { actorId: 'system:entitlement-boundary' })
    organization = await Organization.findOne({ organizationId })
    if (!organization || organization.isBlocked) throw new ApiError(403, 'Organization is unavailable')
  }
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
  let effectiveLeadLimit = Number(plan?.maxLeads ?? baseTrial.maxLeads)
  if (plan?.leadAllowanceModel === 'active_capacity' && organization.subscription.plan !== 'trial') {
    const now = new Date()
    const benefitQuery = SubscriptionBenefitPeriod.findOne({
      organizationId,
      planId: organization.subscription.plan,
      planVersion: organization.subscription.planVersion,
      leadAllowanceModel: 'active_capacity',
      periodStart: { $lte: now },
      periodEnd: { $gt: now },
    }).sort({ periodStart: -1, _id: -1 }).select('totalLeadAllowance').lean()
    const benefit: any = await withSession(benefitQuery, session)
    effectiveLeadLimit = Math.max(0, Number(benefit?.totalLeadAllowance ?? plan.baseMonthlyLeadAllowance ?? plan.maxLeads ?? baseTrial.maxLeads))
  }
  return {
    organization,
    limits: {
      ...baseTrial,
      ...canonicalPlan,
      maxTeamMembers: Number(organization.subscription.maxAgents ?? persistedPlanTeamLimit ?? baseTrial.maxTeamMembers),
      maxProperties: Number(organization.subscription.maxProperties ?? plan?.maxProperties ?? baseTrial.maxProperties),
      maxLeads: effectiveLeadLimit,
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

const countLimitedResourceUsage = async (
  organizationId: string,
  resource: LimitedResource,
  session?: ClientSession,
  protectedOwnerId?: unknown,
): Promise<number> => {
  if (resource === 'properties') {
    return withSession(Property.countDocuments({ organizationId, ...propertyCountsTowardQuotaFilter() }), session)
  }
  if (resource === 'teamMembers') {
    let canonicalOwnerId = protectedOwnerId
    if (!canonicalOwnerId) {
      const legacyOwnerQuery = User.findOne({ organizationId, userRole: 'agency_owner' })
        .select('_id')
        .sort({ createdAt: 1, _id: 1 })
      canonicalOwnerId = (await withSession(legacyOwnerQuery, session).lean())?._id
    }
    const protectedOwnerClause = canonicalOwnerId ? [{ _id: canonicalOwnerId }] : []
    return withSession(User.countDocuments({
      organizationId,
      userRole: { $in: TEAM_MEMBER_SEAT_ROLES },
      // Only the canonical Organization.ownerId is a protected subscribed seat
      // while blocked. Legacy tenants without ownerId deterministically fall back
      // to the oldest agency_owner. Additional owner-role records are normal seats.
      $or: [{ status: { $ne: 'blocked' } }, ...protectedOwnerClause],
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
    countLimitedResourceUsage(organizationId, 'teamMembers', session, resolved.organization.ownerId),
    countReservedTeamMembers(organizationId, session),
  ])
  return buildTeamMemberQuotaContract(Number(resolved.limits.maxTeamMembers || 0), teamMembersUsed, teamMembersReserved)
}


const getPropertyQuotaSnapshot = async (organizationId: string, session?: ClientSession, resolvedInput?: Awaited<ReturnType<typeof resolve>>) => {
  const resolved = resolvedInput || await resolve(organizationId, session)
  const propertiesUsed = await countLimitedResourceUsage(organizationId, 'properties', session)
  const maxProperties = Math.max(0, Number(resolved.limits.maxProperties || 0))
  return {
    maxProperties,
    propertiesUsed,
    propertiesAvailable: Math.max(0, maxProperties - propertiesUsed),
    propertiesOverCapacityBy: Math.max(0, propertiesUsed - maxProperties),
  }
}

const getUsageSnapshot = async (organizationId: string) => {
  const resolved = await resolve(organizationId)
  const [properties, teamMembersUsed, teamMembersReserved, leads] = await Promise.all([
    countLimitedResourceUsage(organizationId, 'properties'),
    countLimitedResourceUsage(organizationId, 'teamMembers', undefined, resolved.organization.ownerId),
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
      `Team member limit reached (${quota.teamMembersCommitted}/${quota.maxTeamMembers}).`,
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

  if (resource === 'properties') {
    await assertPropertyCapacity(organizationId, { additionalCommitments: increment, session })
    return
  }

  const { organization, limits } = await resolve(organizationId, session)
  const usage = await countLimitedResourceUsage(organizationId, resource, session)
  const maximum = limits.maxLeads

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


const localPropertyQuotaLocks = new Map<string, Promise<void>>()

const withLocalPropertyQuotaLock = async <T>(organizationId: string, work: (session?: ClientSession) => Promise<T>): Promise<T> => {
  const previous = localPropertyQuotaLocks.get(organizationId) || Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => { release = resolveGate })
  const chain = previous.then(() => gate)
  localPropertyQuotaLocks.set(organizationId, chain)
  await previous
  try {
    return await work(undefined)
  } finally {
    release()
    if (localPropertyQuotaLocks.get(organizationId) === chain) localPropertyQuotaLocks.delete(organizationId)
  }
}

const withPropertyQuotaGuard = async <T>(organizationId: string, work: (session?: ClientSession) => Promise<T>): Promise<T> => {
  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try {
      let value: T | undefined
      await session.withTransaction(async () => {
        const lock = await Organization.updateOne(
          { organizationId },
          { $inc: { propertyQuotaRevision: 1 } },
          { session },
        )
        if (!lock.matchedCount) throw new ApiError(404, 'Organization not found')
        value = await work(session)
      })
      if (value === undefined) throw new ApiError(500, 'Property quota transaction did not complete')
      return value
    } finally {
      await session.endSession()
    }
  }

  if (config.env === 'production') {
    throw new ApiError(503, 'Property quota changes require a MongoDB replica set or mongos in production')
  }
  return withLocalPropertyQuotaLock(organizationId, work)
}

const assertPropertyCapacity = async (
  organizationId: string,
  options: { additionalCommitments?: number; session?: ClientSession } = {},
): Promise<void> => {
  const additionalCommitments = Math.max(0, Number(options.additionalCommitments || 0))
  const resolved = await resolve(organizationId, options.session)
  const quota = await getPropertyQuotaSnapshot(organizationId, options.session, resolved)
  const required = quota.propertiesUsed + additionalCommitments
  if (required > quota.maxProperties) {
    const recommendedPlan = await recommendPlanForLimit('properties', required)
    throw new ApiError(
      409,
      `Property limit reached (${quota.propertiesUsed}/${quota.maxProperties}). Lock or move another listing off market first.`,
      '',
      'PROPERTY_QUOTA_LIMIT_REACHED',
      {
        resource: 'properties',
        ...quota,
        requestedIncrement: additionalCommitments,
        currentPlan: resolved.organization.subscription.plan,
        recommendedPlan,
      },
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



const localSubscriptionBenefitLocks = new Map<string, Promise<void>>()

const withLocalSubscriptionBenefitLock = async <T>(organizationId: string, work: (session?: ClientSession) => Promise<T>): Promise<T> => {
  const previous = localSubscriptionBenefitLocks.get(organizationId) || Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => { release = resolveGate })
  const chain = previous.then(() => gate)
  localSubscriptionBenefitLocks.set(organizationId, chain)
  await previous
  try {
    return await work(undefined)
  } finally {
    release()
    if (localSubscriptionBenefitLocks.get(organizationId) === chain) localSubscriptionBenefitLocks.delete(organizationId)
  }
}

const withSubscriptionBenefitGuard = async <T>(organizationId: string, work: (session?: ClientSession) => Promise<T>): Promise<T> => {
  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try {
      let value: T | undefined
      await session.withTransaction(async () => {
        // Support streak adjustments and paid subscription writes both touch the
        // organization document. This revision provides an explicit tenant mutex
        // so a support adjustment cannot race a payment-confirmation transaction.
        const lock = await Organization.updateOne(
          { organizationId },
          { $inc: { subscriptionBenefitRevision: 1 } },
          { session },
        )
        if (!lock.matchedCount) throw new ApiError(404, 'Organization not found')
        value = await work(session)
      })
      if (value === undefined) throw new ApiError(500, 'Subscription benefit transaction did not complete')
      return value
    } finally {
      await session.endSession()
    }
  }

  if (config.env === 'production') {
    throw new ApiError(503, 'Subscription benefit adjustments require a MongoDB replica set or mongos in production')
  }
  return withLocalSubscriptionBenefitLock(organizationId, work)
}



export interface LeadAllowanceReservationResult {
  reservationId: string | null
  mode: 'benefit_period' | 'pipeline_fallback'
  benefitPeriodId: string | null
  requestedUnits: number
  grantedUnits: number
  usedUnits: number
  limitUnits: number
  availableUnits: number
  source: LeadAllowanceSource
  legacyFallback: boolean
  periodInactive: boolean
}

const LEAD_ALLOWANCE_RESERVATION_TTL_MS = 30 * 60 * 1000
const localLeadQuotaLocks = new Map<string, Promise<void>>()

const withLocalLeadQuotaLock = async <T>(organizationId: string, work: (session?: ClientSession) => Promise<T>): Promise<T> => {
  const previous = localLeadQuotaLocks.get(organizationId) || Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => { release = resolveGate })
  const chain = previous.then(() => gate)
  localLeadQuotaLocks.set(organizationId, chain)
  await previous
  try {
    return await work(undefined)
  } finally {
    release()
    if (localLeadQuotaLocks.get(organizationId) === chain) localLeadQuotaLocks.delete(organizationId)
  }
}

const withLeadQuotaGuard = async <T>(organizationId: string, work: (session?: ClientSession) => Promise<T>): Promise<T> => {
  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try {
      let value: T | undefined
      await session.withTransaction(async () => {
        const lock = await Organization.updateOne(
          { organizationId },
          { $inc: { leadQuotaRevision: 1 } },
          { session },
        )
        if (!lock.matchedCount) throw new ApiError(404, 'Organization not found')
        value = await work(session)
      })
      if (value === undefined) throw new ApiError(500, 'Lead allowance transaction did not complete')
      return value
    } finally {
      await session.endSession()
    }
  }

  if (config.env === 'production') {
    throw new ApiError(503, 'Lead allowance changes require a MongoDB replica set or mongos in production')
  }
  return withLocalLeadQuotaLock(organizationId, work)
}

const outstandingLeadReservationUnits = async (
  organizationId: string,
  session?: ClientSession,
  filter: { mode?: 'benefit_period' | 'pipeline_fallback'; benefitPeriodId?: unknown } = {},
): Promise<number> => {
  const match: Record<string, unknown> = {
    organizationId,
    status: 'reserved',
    expiresAt: { $gt: new Date() },
    ...(filter.mode ? { mode: filter.mode } : {}),
    ...(filter.benefitPeriodId ? { benefitPeriodId: filter.benefitPeriodId } : {}),
  }
  const aggregation = LeadAllowanceReservation.aggregate([
    { $match: match },
    { $project: { outstanding: { $max: [0, { $subtract: ['$grantedUnits', { $add: ['$consumedUnits', '$releasedUnits'] }] }] } } },
    { $group: { _id: null, total: { $sum: '$outstanding' } } },
  ])
  if (session) aggregation.session(session)
  const rows = await aggregation
  return Math.max(0, Number(rows[0]?.total || 0))
}

const outstandingFallbackReservationUnits = async (organizationId: string, session?: ClientSession): Promise<number> =>
  outstandingLeadReservationUnits(organizationId, session, { mode: 'pipeline_fallback' })

const activeBenefitPeriod = async (organizationId: string, session?: ClientSession) => {
  const now = new Date()
  const query = SubscriptionBenefitPeriod.findOne({
    organizationId,
    periodStart: { $lte: now },
    periodEnd: { $gt: now },
  }).sort({ periodStart: -1, _id: -1 })
  if (session) query.session(session)
  return query
}

const latestBenefitPeriod = async (organizationId: string, session?: ClientSession) => {
  const query = SubscriptionBenefitPeriod.findOne({ organizationId }).sort({ periodEnd: -1, _id: -1 })
  if (session) query.session(session)
  return query
}

const leadAllowanceError = (snapshot: {
  mode: 'benefit_period' | 'pipeline_fallback'
  used: number
  limit: number
  requested: number
  currentPlan: string
  benefitPeriodId?: string | null
}) => new ApiError(
  409,
  snapshot.mode === 'benefit_period'
    ? `Lead capacity reached (${snapshot.used}/${snapshot.limit}).`
    : `Lead limit reached (${snapshot.used}/${snapshot.limit}).`,
  '',
  'LEAD_ALLOWANCE_EXHAUSTED',
  {
    resource: 'leads',
    allowanceMode: snapshot.mode,
    used: snapshot.used,
    limit: snapshot.limit,
    remaining: Math.max(0, snapshot.limit - snapshot.used),
    requestedIncrement: snapshot.requested,
    currentPlan: snapshot.currentPlan,
    benefitPeriodId: snapshot.benefitPeriodId || null,
  },
)

const inactiveBenefitPeriodError = (currentPlan: string) => new ApiError(
  409,
  'No active paid benefit period is available. Confirm the next subscription payment to restore lead capacity.',
  '',
  'LEAD_BENEFIT_PERIOD_INACTIVE',
  { resource: 'leads', currentPlan, remaining: 0 },
)

const reserveLeadAllowance = async (
  organizationId: string,
  requestedUnits = 1,
  options: { allowPartial?: boolean; source?: LeadAllowanceSource } = {},
): Promise<LeadAllowanceReservationResult> => {
  const requested = Math.max(1, Math.trunc(Number(requestedUnits || 1)))
  const allowPartial = Boolean(options.allowPartial)
  const source = options.source || 'api'

  return withLeadQuotaGuard(organizationId, async (session) => {
    const resolved = await resolve(organizationId, session)
    const benefit: any = await activeBenefitPeriod(organizationId, session)
    const latestBenefit: any = benefit || await latestBenefitPeriod(organizationId, session)
    let mode: 'benefit_period' | 'pipeline_fallback' = 'pipeline_fallback'
    let benefitPeriodId: string | null = null
    let used = 0
    let limit = 0
    let legacyFallback = true
    let periodInactive = false

    if (benefit) {
      mode = 'benefit_period'
      benefitPeriodId = String(benefit._id)
      limit = Math.max(0, Number(benefit.totalLeadAllowance || 0))
      if (benefit.leadAllowanceModel === 'active_capacity') {
        const [pipelineUsed, outstanding] = await Promise.all([
          countLimitedResourceUsage(organizationId, 'leads', session),
          outstandingLeadReservationUnits(organizationId, session, { mode: 'benefit_period', benefitPeriodId: benefit._id }),
        ])
        used = pipelineUsed + outstanding
      } else {
        // Grandfathered benefit periods retain the historical paid-period credit counter.
        used = Math.max(0, Number(benefit.usedLeadAllowance || 0))
      }
      legacyFallback = false
    } else if (latestBenefit && resolved.organization.subscription.plan !== 'trial') {
      // Once a tenant has entered the benefit-ledger system, an expired period cannot
      // silently fall back to the old active-pipeline cap. That would let a lapsed paid
      // subscription bypass the monthly allowance until the next confirmed payment.
      mode = 'benefit_period'
      legacyFallback = false
      periodInactive = true
      used = 0
      limit = 0
    } else {
      const [pipelineUsed, outstanding] = await Promise.all([
        countLimitedResourceUsage(organizationId, 'leads', session),
        outstandingFallbackReservationUnits(organizationId, session),
      ])
      used = pipelineUsed + outstanding
      limit = Math.max(0, Number(resolved.limits.maxLeads || 0))
    }

    const available = Math.max(0, limit - used)
    const granted = allowPartial ? Math.min(requested, available) : (requested <= available ? requested : 0)
    if (granted < 1) {
      if (allowPartial) {
        return {
          reservationId: null,
          mode,
          benefitPeriodId,
          requestedUnits: requested,
          grantedUnits: 0,
          usedUnits: used,
          limitUnits: limit,
          availableUnits: available,
          source,
          legacyFallback,
          periodInactive,
        }
      }
      if (periodInactive) throw inactiveBenefitPeriodError(resolved.organization.subscription.plan)
      throw leadAllowanceError({
        mode,
        used,
        limit,
        requested,
        currentPlan: resolved.organization.subscription.plan,
        benefitPeriodId,
      })
    }

    if (mode === 'benefit_period' && benefit?.leadAllowanceModel !== 'active_capacity') {
      const updated = await SubscriptionBenefitPeriod.updateOne(
        {
          _id: benefit!._id,
          organizationId,
          $expr: { $lte: [{ $add: ['$usedLeadAllowance', granted] }, '$totalLeadAllowance'] },
        },
        { $inc: { usedLeadAllowance: granted } },
        session ? { session } : undefined,
      )
      if (!updated.modifiedCount) {
        throw leadAllowanceError({
          mode,
          used: Number(benefit!.usedLeadAllowance || 0),
          limit: Number(benefit!.totalLeadAllowance || 0),
          requested: granted,
          currentPlan: resolved.organization.subscription.plan,
          benefitPeriodId,
        })
      }
    }

    const reservationId = randomUUID()
    await LeadAllowanceReservation.create([{
      reservationId,
      organizationId,
      mode,
      benefitPeriodId: benefit?._id,
      source,
      requestedUnits: requested,
      grantedUnits: granted,
      consumedUnits: 0,
      releasedUnits: 0,
      status: 'reserved',
      expiresAt: new Date(Date.now() + LEAD_ALLOWANCE_RESERVATION_TTL_MS),
    }], session ? { session } : undefined)

    return {
      reservationId,
      mode,
      benefitPeriodId,
      requestedUnits: requested,
      grantedUnits: granted,
      usedUnits: used,
      limitUnits: limit,
      availableUnits: Math.max(0, available - granted),
      source,
      legacyFallback,
      periodInactive,
    }
  })
}

const consumeLeadAllowanceReservation = async (organizationId: string, reservationId: string, units = 1): Promise<void> => {
  const increment = Math.max(1, Math.trunc(Number(units || 1)))
  const reservation: any = await LeadAllowanceReservation.findOneAndUpdate(
    {
      organizationId,
      reservationId,
      status: 'reserved',
      $expr: { $lte: [{ $add: ['$consumedUnits', '$releasedUnits', increment] }, '$grantedUnits'] },
    },
    { $inc: { consumedUnits: increment } },
    { new: true },
  )
  if (!reservation) throw new ApiError(409, 'Lead allowance reservation is no longer available', '', 'LEAD_ALLOWANCE_RESERVATION_INVALID')
  if (Number(reservation.consumedUnits || 0) + Number(reservation.releasedUnits || 0) >= Number(reservation.grantedUnits || 0)) {
    reservation.status = Number(reservation.consumedUnits || 0) > 0 ? 'finalized' : 'released'
    await reservation.save()
  }
}

const releaseLeadAllowanceReservation = async (
  organizationId: string,
  reservationId: string,
  requestedUnits?: number,
): Promise<number> => withLeadQuotaGuard(organizationId, async (session) => {
  const query = LeadAllowanceReservation.findOne({ organizationId, reservationId })
  if (session) query.session(session)
  const reservation: any = await query
  if (!reservation || reservation.status !== 'reserved') return 0
  const outstanding = Math.max(0, Number(reservation.grantedUnits || 0) - Number(reservation.consumedUnits || 0) - Number(reservation.releasedUnits || 0))
  const release = requestedUnits == null ? outstanding : Math.min(outstanding, Math.max(0, Math.trunc(Number(requestedUnits || 0))))
  if (!release) return 0

  if (reservation.mode === 'benefit_period' && reservation.benefitPeriodId) {
    const benefitQuery = SubscriptionBenefitPeriod.findOne({ _id: reservation.benefitPeriodId, organizationId }).select('leadAllowanceModel')
    if (session) benefitQuery.session(session)
    const benefit: any = await benefitQuery.lean()
    if (benefit?.leadAllowanceModel !== 'active_capacity') {
      const benefitUpdate = await SubscriptionBenefitPeriod.updateOne(
        { _id: reservation.benefitPeriodId, organizationId, usedLeadAllowance: { $gte: release } },
        { $inc: { usedLeadAllowance: -release } },
        session ? { session } : undefined,
      )
      if (!benefitUpdate.modifiedCount) throw new ApiError(409, 'Unable to release lead allowance safely', '', 'LEAD_ALLOWANCE_RELEASE_CONFLICT')
    }
  }

  reservation.releasedUnits = Number(reservation.releasedUnits || 0) + release
  if (Number(reservation.consumedUnits || 0) + Number(reservation.releasedUnits || 0) >= Number(reservation.grantedUnits || 0)) {
    reservation.status = Number(reservation.consumedUnits || 0) > 0 ? 'finalized' : 'released'
  }
  await reservation.save(session ? { session } : undefined)
  return release
})

const getMonthlyLeadAllowanceSnapshot = async (organizationId: string) => {
  const resolved = await resolve(organizationId)
  const benefit: any = await activeBenefitPeriod(organizationId)
  if (benefit) {
    const limit = Math.max(0, Number(benefit.totalLeadAllowance || 0))
    const used = benefit.leadAllowanceModel === 'active_capacity'
      ? (await Promise.all([
        countLimitedResourceUsage(organizationId, 'leads'),
        outstandingLeadReservationUnits(organizationId, undefined, { mode: 'benefit_period', benefitPeriodId: benefit._id }),
      ])).reduce((sum, value) => sum + value, 0)
      : Math.max(0, Number(benefit.usedLeadAllowance || 0))
    return {
      mode: 'benefit_period' as const,
      benefitPeriodId: String(benefit._id),
      used,
      limit,
      remaining: Math.max(0, limit - used),
      renewalStreak: Number(benefit.renewalStreak || 1),
      baseLeadAllowance: Number(benefit.baseLeadAllowance || 0),
      bonusLeadAllowance: Number(benefit.bonusLeadAllowance || 0),
      billingCycle: benefit.billingCycle || null,
      leadAllowanceModel: benefit.leadAllowanceModel === 'active_capacity' ? 'active_capacity' : 'paid_period_credits',
      renewalBonusEnabled: benefit.renewalBonusEnabled === true,
      renewalLeadBonus: Number(benefit.renewalLeadBonus || 0),
      maxRenewalLeadBonus: Number(benefit.maxRenewalLeadBonus || 0),
      continuityGraceDays: Number(benefit.continuityGraceDays || 0),
      planId: benefit.planId,
      planVersion: benefit.planVersion,
      periodStart: benefit.periodStart,
      periodEnd: benefit.periodEnd,
      previousBenefitPeriodId: null,
      legacyFallback: false,
      periodInactive: false,
    }
  }
  const latest: any = await latestBenefitPeriod(organizationId)
  if (latest && resolved.organization.subscription.plan !== 'trial') {
    return {
      mode: 'benefit_period' as const,
      benefitPeriodId: null,
      used: 0,
      limit: 0,
      remaining: 0,
      renewalStreak: Number(latest.renewalStreak || 1),
      baseLeadAllowance: 0,
      bonusLeadAllowance: 0,
      billingCycle: latest.billingCycle || null,
      leadAllowanceModel: latest.leadAllowanceModel === 'active_capacity' ? 'active_capacity' : 'paid_period_credits',
      renewalBonusEnabled: latest.renewalBonusEnabled === true,
      renewalLeadBonus: Number(latest.renewalLeadBonus || 0),
      maxRenewalLeadBonus: Number(latest.maxRenewalLeadBonus || 0),
      continuityGraceDays: Number(latest.continuityGraceDays || 0),
      planId: resolved.organization.subscription.plan,
      planVersion: resolved.organization.subscription.planVersion,
      periodStart: null,
      periodEnd: null,
      previousBenefitPeriodId: String(latest._id),
      legacyFallback: false,
      periodInactive: true,
      previousPeriodEnd: latest.periodEnd,
    }
  }
  const [pipelineUsed, outstanding] = await Promise.all([
    countLimitedResourceUsage(organizationId, 'leads'),
    outstandingFallbackReservationUnits(organizationId),
  ])
  const limit = Math.max(0, Number(resolved.limits.maxLeads || 0))
  const used = pipelineUsed + outstanding
  return {
    mode: 'pipeline_fallback' as const,
    benefitPeriodId: null,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    renewalStreak: 1,
    baseLeadAllowance: limit,
    bonusLeadAllowance: 0,
    billingCycle: null,
    leadAllowanceModel: 'paid_period_credits' as const,
    renewalBonusEnabled: false,
    renewalLeadBonus: 0,
    maxRenewalLeadBonus: 0,
    continuityGraceDays: 0,
    planId: resolved.organization.subscription.plan,
    planVersion: resolved.organization.subscription.planVersion,
    periodStart: null,
    periodEnd: resolved.organization.subscription.currentPeriodEnd || null,
    previousBenefitPeriodId: null,
    legacyFallback: true,
    periodInactive: false,
  }
}

const cleanupStaleLeadAllowanceReservations = async (limit = 100) => {
  const stale = await LeadAllowanceReservation.find({ status: 'reserved', expiresAt: { $lt: new Date() } })
    .sort({ expiresAt: 1, _id: 1 })
    .limit(Math.max(1, Math.min(500, limit)))
    .lean()
  let checked = 0
  let finalized = 0
  let released = 0
  for (const row of stale as any[]) {
    checked += 1
    await withLeadQuotaGuard(row.organizationId, async (session) => {
      const reservationQuery = LeadAllowanceReservation.findOne({ organizationId: row.organizationId, reservationId: row.reservationId, status: 'reserved' })
      if (session) reservationQuery.session(session)
      const reservation: any = await reservationQuery
      if (!reservation || new Date(reservation.expiresAt).getTime() > Date.now()) return true

      const linkedQuery = Lead.countDocuments({ organizationId: row.organizationId, leadAllowanceReservationId: row.reservationId })
      const linked = session ? await linkedQuery.session(session) : await linkedQuery
      const consumedTarget = Math.min(Number(reservation.grantedUnits || 0), Math.max(Number(reservation.consumedUnits || 0), Number(linked || 0)))
      reservation.consumedUnits = consumedTarget
      const outstanding = Math.max(0, Number(reservation.grantedUnits || 0) - consumedTarget - Number(reservation.releasedUnits || 0))

      if (outstanding && reservation.mode === 'benefit_period' && reservation.benefitPeriodId) {
        const benefitQuery = SubscriptionBenefitPeriod.findOne({ _id: reservation.benefitPeriodId, organizationId: row.organizationId }).select('leadAllowanceModel')
        if (session) benefitQuery.session(session)
        const benefit: any = await benefitQuery.lean()
        if (benefit?.leadAllowanceModel !== 'active_capacity') {
          await SubscriptionBenefitPeriod.updateOne(
            { _id: reservation.benefitPeriodId, organizationId: row.organizationId, usedLeadAllowance: { $gte: outstanding } },
            { $inc: { usedLeadAllowance: -outstanding } },
            session ? { session } : undefined,
          )
        }
      }
      reservation.releasedUnits = Number(reservation.releasedUnits || 0) + outstanding
      reservation.status = consumedTarget > 0 ? 'finalized' : 'released'
      await reservation.save(session ? { session } : undefined)
      if (consumedTarget > 0) finalized += 1
      if (outstanding > 0) released += outstanding
      return true
    })
  }
  return { checked, finalized, released }
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
  getPropertyQuotaSnapshot,
  assertLimit,
  assertTeamMemberCapacity,
  withTeamMemberQuotaGuard,
  withSubscriptionBenefitGuard,
  withPropertyQuotaGuard,
  assertPropertyCapacity,
  withLeadQuotaGuard,
  reserveLeadAllowance,
  consumeLeadAllowanceReservation,
  releaseLeadAllowanceReservation,
  getMonthlyLeadAllowanceSnapshot,
  cleanupStaleLeadAllowanceReservations,
  assertFeature,
  hasFeature,
  assertStorage,
  consumeVisitor,
}
