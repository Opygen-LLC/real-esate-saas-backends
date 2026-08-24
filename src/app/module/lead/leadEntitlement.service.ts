import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { RealtimeService } from '../realtime/realtime.service'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { resolvePlanOrdering } from '../subscriptionPlan/planIdentity'
import { Lead } from './lead.model'

export const LEAD_SUBSCRIPTION_LOCK_REASON = 'subscription_limit' as const
export const LOCKED_LEAD_PHONE_MASK = '••••••••••'
export const LOCKED_LEAD_EMAIL_MASK = '••••••••'
export const LOCKED_LEAD_MESSAGE = 'These leads are available only with a higher plan. Upgrade your subscription to access them.'
export const subscriptionAccessibleLeadFilter = () => ({ isLocked: { $ne: true } })

const recommendedUpgradePlan = async (currentPlan: string, currentPlanVersion?: number, session?: ClientSession): Promise<string | null> => {
  let currentRank = 0
  if (currentPlan !== 'trial') {
    const currentQuery = SubscriptionPlan.findOne({
      planId: currentPlan,
      ...(currentPlanVersion ? { version: currentPlanVersion } : { isCurrent: true }),
    }).select('planId tierRank upgradeRank displayOrder')
    if (session) currentQuery.session(session)
    const current: any = await currentQuery.lean()
    if (!current) return null
    currentRank = Number(resolvePlanOrdering(current).tierRank)
  }

  const candidatesQuery = SubscriptionPlan.find({ isCurrent: true, isActive: true })
    .select('planId tierRank upgradeRank displayOrder')
  if (session) candidatesQuery.session(session)
  const candidates: any[] = await candidatesQuery.lean()
  const next = candidates
    .map((plan) => resolvePlanOrdering(plan))
    .filter((plan) => Number(plan.tierRank) > currentRank)
    .sort((a, b) => Number(a.tierRank) - Number(b.tierRank))[0]
  return next?.planId ? String(next.planId) : null
}

const sessionOptions = (session?: ClientSession) => session ? { session } : undefined
const withSession = <T extends { session: (session: ClientSession) => T }>(query: T, session?: ClientSession): T => {
  if (session) query.session(session)
  return query
}

export type LeadCapacityReconciliationResult = {
  limit: number
  used: number
  accessible: number
  subscriptionLockedCount: number
  lockedCount: number
  unlockedCount: number
  overCapacityBy: number
  preserved: true
}

const upgradeError = async (input: {
  leadId?: string
  currentPlan: string
  currentPlanVersion?: number
  limit: number
  lockedCount?: number
  session?: ClientSession
}) => new ApiError(
  402,
  LOCKED_LEAD_MESSAGE,
  '',
  'PLAN_UPGRADE_REQUIRED',
  {
    resource: 'leads',
    reason: LEAD_SUBSCRIPTION_LOCK_REASON,
    ...(input.leadId ? { leadId: input.leadId } : {}),
    currentPlan: input.currentPlan,
    limit: Math.max(0, Number(input.limit || 0)),
    recommendedPlan: await recommendedUpgradePlan(input.currentPlan, input.currentPlanVersion, input.session),
    ...(input.lockedCount ? { lockedCount: input.lockedCount } : {}),
  },
)

/**
 * Reconciles the persistent Lead access set to an active-capacity ceiling.
 * Newest records win deterministically by createdAt then _id. No Lead is deleted.
 *
 * The count fast-path makes normal list/detail reads cheap after reconciliation:
 * the expensive newest-N query only runs when the desired number of locked rows
 * differs from the persisted subscription-lock count (capacity/record-count change).
 */
const reconcileLeadCapacity = async (
  organizationId: string,
  requestedLimit: number,
  session?: ClientSession,
  actorId = 'system:lead-capacity',
): Promise<LeadCapacityReconciliationResult> => {
  const limit = Math.max(0, Math.floor(Number(requestedLimit || 0)))
  const totalQuery = Lead.countDocuments({ organizationId })
  const lockedQuery = Lead.countDocuments({
    organizationId,
    isLocked: true,
    lockReason: LEAD_SUBSCRIPTION_LOCK_REASON,
  })
  if (session) {
    totalQuery.session(session)
    lockedQuery.session(session)
  }
  const [totalBefore, lockedBefore] = await Promise.all([totalQuery, lockedQuery])
  const desiredLocked = Math.max(0, totalBefore - limit)

  if (lockedBefore === desiredLocked) {
    return {
      limit,
      used: totalBefore,
      accessible: Math.max(0, totalBefore - lockedBefore),
      subscriptionLockedCount: lockedBefore,
      lockedCount: 0,
      unlockedCount: 0,
      overCapacityBy: desiredLocked,
      preserved: true,
    }
  }

  const accessibleRows: any[] = limit > 0
    ? await (() => {
      const query = Lead.find({ organizationId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .select('_id')
        .lean()
      if (session) query.session(session)
      return query
    })()
    : []
  const accessibleIds = accessibleRows.map((row) => row._id)
  const now = new Date()

  const lockFilter: Record<string, unknown> = {
    organizationId,
    ...(accessibleIds.length ? { _id: { $nin: accessibleIds } } : {}),
    $and: [
      {
        $or: [
          { lockReason: { $exists: false } },
          { lockReason: null },
          { lockReason: LEAD_SUBSCRIPTION_LOCK_REASON },
        ],
      },
      {
        $or: [
          { isLocked: { $ne: true } },
          { lockReason: { $ne: LEAD_SUBSCRIPTION_LOCK_REASON } },
        ],
      },
    ],
  }
  const lockResult = await Lead.updateMany(
    lockFilter,
    {
      $set: {
        isLocked: true,
        lockReason: LEAD_SUBSCRIPTION_LOCK_REASON,
        lockedAt: now,
        lockedBy: actorId,
      },
    },
    sessionOptions(session),
  )

  let unlockedCount = 0
  if (accessibleIds.length) {
    const unlockResult = await Lead.updateMany(
      {
        organizationId,
        _id: { $in: accessibleIds },
        isLocked: true,
        lockReason: LEAD_SUBSCRIPTION_LOCK_REASON,
      },
      {
        $set: {
          isLocked: false,
          lockReason: null,
          lockedAt: null,
          lockedBy: null,
        },
      },
      sessionOptions(session),
    )
    unlockedCount = Number(unlockResult.modifiedCount || 0)
  }

  const totalAfterQuery = Lead.countDocuments({ organizationId })
  const lockedAfterQuery = Lead.countDocuments({ organizationId, isLocked: true, lockReason: LEAD_SUBSCRIPTION_LOCK_REASON })
  if (session) {
    totalAfterQuery.session(session)
    lockedAfterQuery.session(session)
  }
  const [used, subscriptionLockedCount] = await Promise.all([totalAfterQuery, lockedAfterQuery])
  return {
    limit,
    used,
    accessible: Math.max(0, used - subscriptionLockedCount),
    subscriptionLockedCount,
    lockedCount: Number(lockResult.modifiedCount || 0),
    unlockedCount,
    overCapacityBy: Math.max(0, used - limit),
    preserved: true,
  }
}

/** Grandfathered/non-active-capacity plans keep their historic access semantics. */
const releaseSubscriptionLeadLocks = async (
  organizationId: string,
  limit: number,
  session?: ClientSession,
): Promise<LeadCapacityReconciliationResult> => {
  const lockedQuery = Lead.countDocuments({ organizationId, isLocked: true, lockReason: LEAD_SUBSCRIPTION_LOCK_REASON })
  const totalQuery = Lead.countDocuments({ organizationId })
  if (session) { lockedQuery.session(session); totalQuery.session(session) }
  const [lockedBefore, used] = await Promise.all([lockedQuery, totalQuery])
  let unlockedCount = 0
  if (lockedBefore > 0) {
    const unlockResult = await Lead.updateMany(
      { organizationId, isLocked: true, lockReason: LEAD_SUBSCRIPTION_LOCK_REASON },
      { $set: { isLocked: false, lockReason: null, lockedAt: null, lockedBy: null } },
      sessionOptions(session),
    )
    unlockedCount = Number(unlockResult.modifiedCount || 0)
  }
  return {
    limit: Math.max(0, Number(limit || 0)),
    used,
    accessible: used,
    subscriptionLockedCount: 0,
    lockedCount: 0,
    unlockedCount,
    overCapacityBy: Math.max(0, used - Math.max(0, Number(limit || 0))),
    preserved: true,
  }
}

const publishCapacityChange = async (organizationId: string, result: LeadCapacityReconciliationResult) => {
  if (!result.lockedCount && !result.unlockedCount) return
  await CacheInvalidationService.invalidateTenant(organizationId)
  RealtimeService.emitOrganization(organizationId, {
    type: 'lead.changed',
    action: 'entitlements_reconciled',
    entityId: organizationId,
    payload: {
      limit: result.limit,
      accessible: result.accessible,
      locked: result.subscriptionLockedCount,
    },
  })
}

/**
 * Request-time boundary guard for Lead reads. This also catches monthly benefit
 * period rollover: if effective capacity changed (e.g. 200 -> 250), the persisted
 * lock set is synchronized before any list/detail data is returned.
 */
const ensureCurrentLeadCapacity = async (
  organizationId: string,
  session?: ClientSession,
): Promise<{ resolved: Awaited<ReturnType<typeof EntitlementService.resolve>>; reconciliation: LeadCapacityReconciliationResult }> => {
  const resolved = await EntitlementService.resolve(organizationId, session)
  const isActiveCapacity = resolved.limits.leadAllowanceModel === 'active_capacity'
  const reconciliation = isActiveCapacity
    ? await reconcileLeadCapacity(organizationId, Number(resolved.limits.maxLeads || 0), session)
    : await releaseSubscriptionLeadLocks(organizationId, Number(resolved.limits.maxLeads || 0), session)
  if (!session) await publishCapacityChange(organizationId, reconciliation)
  return { resolved, reconciliation }
}

/** Canonical server-side lock guard for an individual Lead. */
const assertLeadAccessible = async (
  organizationId: string,
  leadId: string,
  session?: ClientSession,
): Promise<void> => {
  const { resolved } = await ensureCurrentLeadCapacity(organizationId, session)
  const query = Lead.findOne({ _id: leadId, organizationId })
    .select('_id isLocked lockReason')
    .lean()
  const lead: any = await withSession(query as any, session)
  if (!lead) throw new ApiError(404, 'Lead not found')
  if (lead.isLocked === true && lead.lockReason === LEAD_SUBSCRIPTION_LOCK_REASON) {
    throw await upgradeError({
      leadId: String(lead._id),
      currentPlan: String(resolved.organization.subscription.plan || 'trial'),
      currentPlanVersion: Number(resolved.organization.subscription.planVersion || 1),
      limit: Number(resolved.limits.maxLeads || 0),
      session,
    })
  }
}

/** Legacy defensive guard retained for compatibility; tenant exports now filter locked Leads out before this point. */
const assertExportContainsNoLockedLeads = async (
  organizationId: string,
  match: Record<string, unknown>,
): Promise<void> => {
  const { resolved } = await ensureCurrentLeadCapacity(organizationId)
  const lockedCount = await Lead.countDocuments({
    $and: [
      match,
      { organizationId, isLocked: true, lockReason: LEAD_SUBSCRIPTION_LOCK_REASON },
    ],
  })
  if (lockedCount > 0) {
    throw await upgradeError({
      currentPlan: String(resolved.organization.subscription.plan || 'trial'),
      currentPlanVersion: Number(resolved.organization.subscription.planVersion || 1),
      limit: Number(resolved.limits.maxLeads || 0),
      lockedCount,
    })
  }
}

/** Backend presenter fallback; optimized aggregate applies the same redaction in MongoDB. */
export const redactLockedLeadForList = <T extends Record<string, any>>(lead: T): T => {
  if (lead?.isLocked !== true || lead?.lockReason !== LEAD_SUBSCRIPTION_LOCK_REASON) return lead
  const redacted: Record<string, any> = {
    ...lead,
    phone: LOCKED_LEAD_PHONE_MASK,
    email: LOCKED_LEAD_EMAIL_MASK,
    normalizedPhone: '',
    normalizedEmail: '',
    notes: '',
  }
  delete redacted.latestNote
  delete redacted.latestInteraction
  delete redacted.contactId
  return redacted as T
}

export const LeadEntitlementService = {
  assertLeadAccessible,
  assertExportContainsNoLockedLeads,
  ensureCurrentLeadCapacity,
  reconcileLeadCapacity,
  releaseSubscriptionLeadLocks,
  publishCapacityChange,
}
