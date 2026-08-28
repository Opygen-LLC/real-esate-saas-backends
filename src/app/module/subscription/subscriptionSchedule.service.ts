import mongoose, { type ClientSession } from 'mongoose'
import httpStatus from 'http-status'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { writeAudit } from '../audit/audit.service'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { TenantAccessTransitionService } from '../tenantAccess/tenantAccessTransition.service'
import { Organization } from '../organization/organization.model'
import { RealtimeService } from '../realtime/realtime.service'
import { SubscriptionChangeRequest } from '../subscriptionChangeRequest/subscriptionChangeRequest.model'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { resolvePlanLeadPolicy } from '../subscriptionPlan/planLeadPolicy'
import { resolvePlanOrdering } from '../subscriptionPlan/planIdentity'
import { SubscriptionBenefitPeriodService } from '../subscriptionBenefitPeriod/subscriptionBenefitPeriod.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import {
  publishSubscriptionEntitlementReconciliation,
  reconcileOrganizationEntitlements,
  type SubscriptionEntitlementReconciliationResult,
} from '../entitlement/subscriptionEntitlementReconciliation.service'

export type PaidPlanId = string
export type SubscriptionChangeType = 'upgrade' | 'downgrade' | 'version_change'
export type ScheduledBillingCycle = 'monthly' | 'yearly'

type ClassifySubscriptionChangeOptions = {
  currentPlanVersion?: number | null
  requestedPlanVersion?: number | null
  session?: ClientSession
}

const planRank = async (planId: string, version?: number | null, session?: ClientSession): Promise<number> => {
  if (planId === 'trial') return 0
  const query = SubscriptionPlan.findOne({
    planId,
    ...(version && Number(version) > 0 ? { version: Number(version) } : { isCurrent: true }),
  }).select('planId tierRank upgradeRank displayOrder')
  if (session) query.session(session)
  const plan: any = await query.lean()
  if (!plan) throw new ApiError(httpStatus.CONFLICT, `Subscription plan rank could not be resolved for ${planId}${version ? ` v${version}` : ''}`)
  return Number(resolvePlanOrdering(plan).tierRank)
}

export const classifySubscriptionChange = async (
  currentPlan: string,
  requestedPlan: string,
  options: ClassifySubscriptionChangeOptions = {},
): Promise<SubscriptionChangeType> => {
  if (currentPlan === requestedPlan) return 'version_change'
  const [currentRank, requestedRank] = await Promise.all([
    planRank(currentPlan, options.currentPlanVersion, options.session),
    planRank(requestedPlan, options.requestedPlanVersion, options.session),
  ])
  if (requestedRank === currentRank) {
    throw new ApiError(httpStatus.CONFLICT, `Plan ranking conflict: ${currentPlan} and ${requestedPlan} have the same plan tier`)
  }
  return requestedRank < currentRank ? 'downgrade' : 'upgrade'
}

export const isSubscriptionDowngrade = async (
  currentPlan: string,
  requestedPlan: string,
  options: ClassifySubscriptionChangeOptions = {},
) => (await classifySubscriptionChange(currentPlan, requestedPlan, options)) === 'downgrade'

const addBillingCycle = (start: Date, billingCycle: ScheduledBillingCycle) => {
  const end = new Date(start)
  if (billingCycle === 'monthly') end.setUTCMonth(end.getUTCMonth() + 1)
  else end.setUTCFullYear(end.getUTCFullYear() + 1)
  return end
}

const objectIdOrNull = (value?: string | mongoose.Types.ObjectId | null) => {
  if (!value) return null
  if (value instanceof mongoose.Types.ObjectId) return value
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : null
}

const runTransaction = async <T>(work: (session?: ClientSession) => Promise<T>): Promise<T> => {
  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try {
      let result: T | undefined
      await session.withTransaction(async () => { result = await work(session) })
      if (result === undefined) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Subscription schedule transaction did not complete')
      return result
    } finally {
      await session.endSession()
    }
  }
  if (config.env === 'production') {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Deferred subscription changes require a MongoDB replica set or mongos in production')
  }
  return work()
}

export type ScheduleDowngradeInput = {
  planId: PaidPlanId
  planVersion: number
  billingCycle: ScheduledBillingCycle
  effectiveAt: Date
  changeRequestId?: string | mongoose.Types.ObjectId | null
  scheduledBy?: string | mongoose.Types.ObjectId | null
  source: 'bkash' | 'manual_payment' | 'manual_admin'
  paidAt?: Date | null
}

/**
 * Mutates an Organization document already loaded in the caller's commercial transaction.
 * The currently active plan/limits are intentionally left untouched until effectiveAt.
 */
const scheduleDowngradeOnOrganization = async (
  organization: any,
  input: ScheduleDowngradeInput,
  session?: ClientSession,
) => {
  const effectiveAt = new Date(input.effectiveAt)
  if (!Number.isFinite(effectiveAt.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, 'Scheduled subscription effective date is invalid')
  if (effectiveAt.getTime() <= Date.now()) throw new ApiError(httpStatus.CONFLICT, 'A deferred downgrade must be scheduled for a future billing boundary')

  const subscription: any = organization.subscription || {}
  const existingPlan = subscription.scheduledPlan ? String(subscription.scheduledPlan) : ''
  const existingVersion = Number(subscription.scheduledPlanVersion || 0)
  const existingEffectiveAt = subscription.scheduledEffectiveAt ? new Date(subscription.scheduledEffectiveAt) : null
  const requestedChangeRequestId = objectIdOrNull(input.changeRequestId)

  if (existingPlan) {
    const sameSchedule = existingPlan === input.planId
      && existingVersion === Number(input.planVersion)
      && existingEffectiveAt?.getTime() === effectiveAt.getTime()
      && String(subscription.scheduledChangeRequestId || '') === String(requestedChangeRequestId || '')
    if (sameSchedule) return { scheduled: false as const, idempotent: true as const }
    throw new ApiError(httpStatus.CONFLICT, 'Another subscription change is already scheduled for this organization')
  }

  subscription.scheduledPlan = input.planId
  subscription.scheduledPlanVersion = Number(input.planVersion)
  subscription.scheduledBillingCycle = input.billingCycle
  subscription.scheduledEffectiveAt = effectiveAt
  subscription.scheduledChangeRequestId = requestedChangeRequestId
  subscription.scheduledBy = objectIdOrNull(input.scheduledBy)
  subscription.scheduledSource = input.source
  subscription.lastPaymentDate = input.paidAt || subscription.lastPaymentDate || null
  subscription.revision = Math.max(0, Number(subscription.revision || 0)) + 1
  organization.subscription = subscription
  await organization.save(session ? { session } : undefined)
  return { scheduled: true as const, idempotent: false as const }
}

const applyDueChange = async (
  organizationId: string,
  options: { now?: Date; actorId?: string } = {},
) => {
  const now = options.now ? new Date(options.now) : new Date()
  let reconciliation: SubscriptionEntitlementReconciliationResult | null = null

  const result = await runTransaction(async (session) => {
    const organizationQuery = Organization.findOne({
      organizationId,
      'subscription.scheduledPlan': { $type: 'string', $ne: '' },
      'subscription.scheduledEffectiveAt': { $lte: now },
    })
    if (session) organizationQuery.session(session)
    const organization: any = await organizationQuery
    if (!organization) return { applied: false as const, organizationId }

    const subscription: any = organization.subscription || {}
    const scheduledPlan = String(subscription.scheduledPlan || '') as PaidPlanId
    const scheduledPlanVersion = Number(subscription.scheduledPlanVersion || 0)
    const scheduledBillingCycle = subscription.scheduledBillingCycle as ScheduledBillingCycle | null
    const scheduledEffectiveAt = subscription.scheduledEffectiveAt ? new Date(subscription.scheduledEffectiveAt) : null
    const scheduledChangeRequestId = subscription.scheduledChangeRequestId || null
    const scheduledSource = subscription.scheduledSource || subscription.source || 'manual_payment'

    if (!scheduledPlan || !scheduledPlanVersion || !scheduledBillingCycle || !scheduledEffectiveAt) {
      throw new ApiError(httpStatus.CONFLICT, 'Scheduled subscription state is incomplete and cannot be applied safely')
    }

    const planQuery = SubscriptionPlan.findOne({ planId: scheduledPlan, version: scheduledPlanVersion })
    if (session) planQuery.session(session)
    const storedTargetPlan: any = await planQuery.lean()
    if (!storedTargetPlan) throw new ApiError(httpStatus.CONFLICT, `Scheduled subscription plan ${scheduledPlan} v${scheduledPlanVersion} no longer exists`)
    const targetPlan: any = resolvePlanLeadPolicy(storedTargetPlan)

    let scheduledRequest: any = null
    if (scheduledChangeRequestId) {
      const requestQuery = SubscriptionChangeRequest.findOne({ _id: scheduledChangeRequestId, organizationId })
      if (session) requestQuery.session(session)
      scheduledRequest = await requestQuery
      if (!scheduledRequest || !['scheduled', 'applied'].includes(String(scheduledRequest.status))) {
        throw new ApiError(httpStatus.CONFLICT, 'The scheduled subscription request is no longer active and cannot be applied')
      }
    }

    const previous = organization.subscription?.toObject?.() || { ...(organization.subscription || {}) }
    const expectedRevision = Math.max(0, Number(subscription.revision || 0))
    const nextPeriodEnd = addBillingCycle(scheduledEffectiveAt, scheduledBillingCycle)

    const update: any = {
      $set: {
        'subscription.plan': scheduledPlan,
        'subscription.planVersion': scheduledPlanVersion,
        'subscription.status': 'active',
        'subscription.currentPeriodEnd': nextPeriodEnd,
        'subscription.maxProperties': Number(targetPlan.maxProperties || 0),
        'subscription.maxAgents': Number(targetPlan.maxAgents ?? targetPlan.maxTeamMembers ?? 0),
        'subscription.trialEndsAt': null,
        'subscription.gracePeriodEnd': null,
        'subscription.cancelAtPeriodEnd': false,
        'subscription.reminderSentAt': null,
        'subscription.source': scheduledSource,
        'subscription.scheduledPlan': null,
        'subscription.scheduledPlanVersion': null,
        'subscription.scheduledBillingCycle': null,
        'subscription.scheduledEffectiveAt': null,
        'subscription.scheduledChangeRequestId': null,
        'subscription.scheduledBy': null,
        'subscription.scheduledSource': null,
      },
      $inc: { 'subscription.revision': 1 },
    }
    const appliedOrganizationQuery = Organization.findOneAndUpdate(
      {
        _id: organization._id,
        'subscription.revision': expectedRevision,
        'subscription.scheduledPlan': scheduledPlan,
        'subscription.scheduledPlanVersion': scheduledPlanVersion,
        'subscription.scheduledEffectiveAt': scheduledEffectiveAt,
      },
      update,
      { new: true, ...(session ? { session } : {}) },
    )
    const appliedOrganization: any = await appliedOrganizationQuery
    if (!appliedOrganization) throw new ApiError(httpStatus.CONFLICT, 'Scheduled subscription changed concurrently; retry the entitlement request')

    const effective = await EntitlementService.resolve(organizationId, session, { allowInactive: true })
    reconciliation = await reconcileOrganizationEntitlements(organizationId, previous, {
      ...(targetPlan || {}),
      maxTeamMembers: Number(effective.limits.maxTeamMembers || 0),
      maxProperties: Number(effective.limits.maxProperties || 0),
      maxLeads: Number(effective.limits.maxLeads || 0),
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
      actorId: options.actorId || 'system:subscription-schedule',
      reason: `Deferred downgrade applied to ${scheduledPlan} v${scheduledPlanVersion}`,
    })

    if (scheduledRequest && scheduledRequest.status !== 'applied') {
      scheduledRequest.status = 'applied'
      scheduledRequest.appliedAt = now
      scheduledRequest.reviewedAt = scheduledRequest.reviewedAt || now
      await scheduledRequest.save(session ? { session } : undefined)
    }

    await writeAudit({
      organizationId,
      actorId: options.actorId || 'system:subscription-schedule',
      actorRole: 'system',
      action: 'subscription.scheduled_change_applied',
      entityType: 'organization',
      entityId: String(appliedOrganization._id),
      reason: `Scheduled ${scheduledPlan} v${scheduledPlanVersion} downgrade reached its billing boundary`,
      metadata: {
        previousSubscription: previous,
        currentSubscription: appliedOrganization.subscription?.toObject?.() || appliedOrganization.subscription,
        scheduledEffectiveAt,
        billingCycle: scheduledBillingCycle,
        changeRequestId: scheduledChangeRequestId ? String(scheduledChangeRequestId) : null,
        reconciliation,
      },
    }, session)

    return {
      applied: true as const,
      organizationId,
      plan: scheduledPlan,
      planVersion: scheduledPlanVersion,
      effectiveAt: scheduledEffectiveAt,
      currentPeriodEnd: nextPeriodEnd,
      changeRequestId: scheduledChangeRequestId ? String(scheduledChangeRequestId) : null,
    }
  })

  if (result.applied) {
    await publishSubscriptionEntitlementReconciliation(reconciliation)
    await TenantAccessTransitionService.sync({
      organizationId,
      source: 'scheduled_subscription_change',
      eventType: 'subscription.scheduled_change_applied',
    })
    RealtimeService.emitOrganization(organizationId, {
      type: 'subscription.changed',
      action: 'applied',
      entityId: result.changeRequestId || organizationId,
      eventType: 'subscription.scheduled_change_applied',
      payload: {
        plan: result.plan,
        planVersion: result.planVersion,
        effectiveAt: result.effectiveAt.toISOString(),
        currentPeriodEnd: result.currentPeriodEnd.toISOString(),
      },
    })
  }

  return result
}

const cancelScheduledChange = async (
  organizationId: string,
  options: { actorId: string; reason?: string; actorRole?: 'agency_owner' | 'super-admin' | 'system' } = { actorId: 'system:subscription-schedule', actorRole: 'system' },
) => {
  const now = new Date()
  const result = await runTransaction(async (session) => {
    const organizationQuery = Organization.findOne({
      organizationId,
      'subscription.scheduledPlan': { $type: 'string', $ne: '' },
      'subscription.scheduledEffectiveAt': { $gt: now },
    })
    if (session) organizationQuery.session(session)
    const organization: any = await organizationQuery
    if (!organization) throw new ApiError(httpStatus.CONFLICT, 'No future scheduled subscription downgrade is available to cancel')

    const subscription: any = organization.subscription || {}
    const scheduledPlan = String(subscription.scheduledPlan || '') as PaidPlanId
    const scheduledPlanVersion = Number(subscription.scheduledPlanVersion || 0)
    const scheduledEffectiveAt = subscription.scheduledEffectiveAt ? new Date(subscription.scheduledEffectiveAt) : null
    const scheduledChangeRequestId = subscription.scheduledChangeRequestId || null
    const scheduledSource = String(subscription.scheduledSource || 'manual_payment')
    const expectedRevision = Math.max(0, Number(subscription.revision || 0))
    if (!scheduledPlan || !scheduledPlanVersion || !scheduledEffectiveAt) {
      throw new ApiError(httpStatus.CONFLICT, 'Scheduled subscription state is incomplete and cannot be cancelled safely')
    }

    let request: any = null
    if (scheduledChangeRequestId) {
      const requestQuery = SubscriptionChangeRequest.findOne({ _id: scheduledChangeRequestId, organizationId })
      if (session) requestQuery.session(session)
      request = await requestQuery
      if (!request || request.status !== 'scheduled') throw new ApiError(httpStatus.CONFLICT, 'The scheduled subscription request is no longer cancellable')
    }

    const reason = String(options.reason || 'Agency cancelled the scheduled downgrade before its billing boundary').trim()
    const voidedBenefitPeriod: any = await SubscriptionBenefitPeriodService.voidScheduledBenefitPeriod({
      organizationId,
      planId: scheduledPlan,
      planVersion: scheduledPlanVersion,
      periodStart: scheduledEffectiveAt,
      actorId: options.actorId,
      reason,
    }, session)

    const updatedOrganizationQuery = Organization.findOneAndUpdate(
      {
        _id: organization._id,
        'subscription.revision': expectedRevision,
        'subscription.scheduledPlan': scheduledPlan,
        'subscription.scheduledPlanVersion': scheduledPlanVersion,
        'subscription.scheduledEffectiveAt': scheduledEffectiveAt,
      },
      {
        $set: {
          'subscription.scheduledPlan': null,
          'subscription.scheduledPlanVersion': null,
          'subscription.scheduledBillingCycle': null,
          'subscription.scheduledEffectiveAt': null,
          'subscription.scheduledChangeRequestId': null,
          'subscription.scheduledBy': null,
          'subscription.scheduledSource': null,
        },
        $inc: { 'subscription.revision': 1 },
      },
      { new: true, ...(session ? { session } : {}) },
    )
    const updatedOrganization: any = await updatedOrganizationQuery
    if (!updatedOrganization) throw new ApiError(httpStatus.CONFLICT, 'Scheduled subscription changed concurrently; refresh billing and try again')

    if (request) {
      request.status = 'cancelled'
      request.reviewedBy = options.actorId
      request.reviewedAt = now
      request.scheduledEffectiveAt = null
      await request.save(session ? { session } : undefined)
    }

    await writeAudit({
      organizationId,
      actorId: options.actorId,
      actorRole: options.actorRole || 'agency_owner',
      action: 'subscription.scheduled_change_cancelled',
      entityType: 'organization',
      entityId: String(updatedOrganization._id),
      reason,
      metadata: {
        scheduledPlan,
        scheduledPlanVersion,
        scheduledEffectiveAt,
        changeRequestId: scheduledChangeRequestId ? String(scheduledChangeRequestId) : null,
        voidedBenefitPeriodId: voidedBenefitPeriod?._id ? String(voidedBenefitPeriod._id) : null,
        scheduledSource,
        financialAdjustmentRequired: scheduledSource === 'bkash' || scheduledSource === 'manual_payment',
        activePlanUnchanged: true,
      },
    }, session)

    return {
      cancelled: true as const,
      organizationId,
      activePlan: String(updatedOrganization.subscription?.plan || 'trial'),
      cancelledPlan: scheduledPlan,
      cancelledPlanVersion: scheduledPlanVersion,
      financialAdjustmentRequired: scheduledSource === 'bkash' || scheduledSource === 'manual_payment',
    }
  })

  await CacheInvalidationService.invalidateTenant(organizationId)
  RealtimeService.emitOrganization(organizationId, {
    type: 'subscription.changed',
    action: 'scheduled_change_cancelled',
    entityId: organizationId,
    eventType: 'subscription.scheduled_change_cancelled',
    payload: result,
  })
  return result
}

const processDueChanges = async (limit = 50, now = new Date()) => {
  const capped = Math.max(1, Math.min(500, Math.trunc(Number(limit || 50))))
  const due: any[] = await Organization.find({
    'subscription.scheduledPlan': { $type: 'string', $ne: '' },
    'subscription.scheduledEffectiveAt': { $lte: now },
    'platformAccess.status': { $ne: 'pending_deletion' },
  })
    .select('organizationId')
    .sort({ 'subscription.scheduledEffectiveAt': 1, _id: 1 })
    .limit(capped)
    .lean()

  let applied = 0
  let skipped = 0
  const failed: Array<{ organizationId: string; error: string }> = []
  for (const row of due) {
    try {
      const outcome = await applyDueChange(String(row.organizationId), { now, actorId: 'system:subscription-worker' })
      if (outcome.applied) applied += 1
      else skipped += 1
    } catch (error) {
      failed.push({ organizationId: String(row.organizationId), error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { checked: due.length, applied, skipped, failed }
}

export const SubscriptionScheduleService = {
  classifySubscriptionChange,
  isSubscriptionDowngrade,
  scheduleDowngradeOnOrganization,
  applyDueChange,
  cancelScheduledChange,
  processDueChanges,
}
