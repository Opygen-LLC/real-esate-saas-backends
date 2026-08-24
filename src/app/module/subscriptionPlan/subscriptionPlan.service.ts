import httpStatus from 'http-status'
import mongoose, { ClientSession } from 'mongoose'
import config from '../../../config'
import { Cache } from '../../../shared/cache'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import ApiError from '../../../errors/ApiError'
import { Organization } from '../organization/organization.model'
import { ISubscriptionPlan, SubscriptionPlanId } from './subscriptionPlan.interface'
import { SubscriptionPlan } from './subscriptionPlan.model'
import { EntitlementService } from '../entitlement/entitlement.service'
import { normalizeEntitlementWrite, resolveEntitlementSource } from '../entitlement/featureCatalog'
import { publishSubscriptionEntitlementReconciliation, reconcileOrganizationEntitlements, type SubscriptionEntitlementReconciliationResult } from '../entitlement/subscriptionEntitlementReconciliation.service'
import { mirrorTierRankWrite, normalizePaidPlanId, resolvePlanOrdering } from './planIdentity'
import { mirrorBaseLeadCapacityWrite, resolveBaseLeadCapacity } from './planLeadCapacity'
import { mirrorPlanStatusWrite, resolvePlanStatus } from './planLifecycle'

type LeadAllowanceConfig = Pick<ISubscriptionPlan,
  'leadAllowanceModel' | 'baseMonthlyLeadAllowance' | 'renewalLeadBonus' | 'renewalBonusEnabled' | 'maxRenewalLeadBonus' | 'continuityGraceDays'
>

const starterLeadAllowanceDefaults: LeadAllowanceConfig = {
  leadAllowanceModel: 'paid_period_credits',
  baseMonthlyLeadAllowance: 200,
  renewalLeadBonus: 50,
  renewalBonusEnabled: true,
  maxRenewalLeadBonus: 500,
  continuityGraceDays: 3,
}

const neutralLeadAllowanceDefaults = (maxLeads: unknown): LeadAllowanceConfig => ({
  leadAllowanceModel: 'paid_period_credits',
  baseMonthlyLeadAllowance: Math.max(0, Number(maxLeads || 0)),
  renewalLeadBonus: 0,
  renewalBonusEnabled: false,
  maxRenewalLeadBonus: 0,
  continuityGraceDays: 0,
})

const normalizeLeadAllowanceConfig = <T extends Record<string, any>>(plan: T): T & LeadAllowanceConfig => {
  // Canonical entitlement values are read first when present. Grandfathered plan
  // documents without the map transparently resolve from their legacy fields.
  const entitlementResolved = resolvePlanOrdering(resolveEntitlementSource(plan))
  // Preserve legacy Starter fallbacks for old documents that pre-date the loyalty fields,
  // but never force Professional/Agency bonuses to zero when the immutable plan version
  // explicitly enables them.
  const fallback = entitlementResolved.planId === 'starter'
    ? starterLeadAllowanceDefaults
    : neutralLeadAllowanceDefaults(entitlementResolved.maxLeads)
  const leadAllowanceModel = entitlementResolved.leadAllowanceModel === 'active_capacity' ? 'active_capacity' : 'paid_period_credits'
  return {
    ...entitlementResolved,
    status: resolvePlanStatus(entitlementResolved),
    baseLeadCapacity: resolveBaseLeadCapacity(entitlementResolved),
    leadAllowanceModel,
    baseMonthlyLeadAllowance: Number(entitlementResolved.baseMonthlyLeadAllowance ?? fallback.baseMonthlyLeadAllowance),
    renewalLeadBonus: Number(entitlementResolved.renewalLeadBonus ?? fallback.renewalLeadBonus),
    renewalBonusEnabled: Boolean(entitlementResolved.renewalBonusEnabled ?? fallback.renewalBonusEnabled),
    maxRenewalLeadBonus: Number(entitlementResolved.maxRenewalLeadBonus ?? fallback.maxRenewalLeadBonus),
    continuityGraceDays: Number(entitlementResolved.continuityGraceDays ?? fallback.continuityGraceDays),
  } as T & LeadAllowanceConfig
}

const validateLeadAllowanceConfig = (plan: Partial<ISubscriptionPlan>) => {
  const base = Number(plan.baseMonthlyLeadAllowance ?? 0)
  const bonus = Number(plan.renewalLeadBonus ?? 0)
  const cap = Number(plan.maxRenewalLeadBonus ?? 0)
  const grace = Number(plan.continuityGraceDays ?? 0)
  const enabled = Boolean(plan.renewalBonusEnabled)

  if (![base, bonus, cap, grace].every(Number.isFinite) || [base, bonus, cap, grace].some((value) => value < 0)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Lead allowance values must be non-negative numbers')
  }
  if (![base, bonus, cap, grace].every(Number.isInteger)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Lead allowance values must be whole numbers')
  }
  if (grace > 31) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Continuity grace period cannot exceed 31 days')
  }
  if (enabled && base < 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Base monthly lead allowance must be at least 1 when renewal bonus is enabled')
  }
  if (enabled && bonus < 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Renewal lead bonus must be at least 1 when renewal bonus is enabled')
  }
  // maxRenewalLeadBonus=0 is the explicit unlimited sentinel for cumulative plans.
  // Positive caps retain the historical capped-bonus behavior.
  if (enabled && cap > 0 && cap < bonus) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Maximum renewal lead bonus must be 0 (unlimited) or at least the per-renewal bonus')
  }
}

const normalizePlanWrite = <T extends Record<string, any>>(
  source: T,
  explicitEntitlements?: unknown,
) => normalizeLeadAllowanceConfig(
  mirrorBaseLeadCapacityWrite(
    mirrorTierRankWrite(
      normalizeEntitlementWrite(source, explicitEntitlements),
    ),
  ),
)

const defaultPlans: Array<Omit<Partial<ISubscriptionPlan>, 'planId'> & { planId: SubscriptionPlanId }> = [
  {
    planId: 'starter', name: 'Starter', tierRank: 10, displayOrder: 10, upgradeRank: 10, priceMonthly: 500, priceYearly: 5000, currency: 'BDT',
    description: 'Perfect for solo real estate agents and boutique teams starting out.',
    features: ['1–3 Team Agents', '100 Property Listings', '200 Leads / Paid Month', '+50 Leads per Consecutive Renewal', 'Up to 500 Active Pipeline Leads', 'Public Agency Website', 'Basic CRM & Activity Feed', 'Agency Subdomain', 'Standard Support'],
    maxAgents: 3, maxProperties: 100, maxLeads: 500, ...starterLeadAllowanceDefaults, hasCustomDomain: false, hasAdvancedAnalytics: false,
    hasWhatsAppIntegration: false, hasLeadAutomations: false, hasSmsAutomation: false, hasPremiumTemplates: false,
    maxStorageMb: 1024, maxMonthlyVisitors: 10000, isPopular: false, isActive: true,
  },
  {
    planId: 'professional', name: 'Professional', tierRank: 20, displayOrder: 20, upgradeRank: 20, priceMonthly: 3490, priceYearly: 34900, currency: 'BDT',
    description: 'Designed for high-growth real estate teams and established agencies.',
    features: ['Up to 10 Team Agents', '1,000 Property Listings', 'Unlimited Leads & Deals', 'Custom Domain (www.agency.com)', 'Advanced Lead Pipeline & Kanban', 'Viewing Calendar & Booking', 'Advanced Real Estate Analytics', 'Priority Email Support'],
    maxAgents: 10, maxProperties: 1000, maxLeads: 10000, ...neutralLeadAllowanceDefaults(10000), hasCustomDomain: true, hasAdvancedAnalytics: true,
    hasWhatsAppIntegration: true, hasLeadAutomations: true, hasSmsAutomation: true, hasPremiumTemplates: true,
    maxStorageMb: 10240, maxMonthlyVisitors: 100000, isPopular: true, isActive: true,
  },
  {
    planId: 'agency', name: 'Agency Scale', tierRank: 30, displayOrder: 30, upgradeRank: 30, priceMonthly: 6990, priceYearly: 69900, currency: 'BDT',
    description: 'Full-featured enterprise platform for large brokerages and multi-office firms.',
    features: ['Unlimited Team Agents', 'Unlimited Property Listings', 'Unlimited Leads & Contacts', 'Custom Domain + Multi-Branch', 'WhatsApp Integration & SMS Marketing', 'Agent Performance Leaderboards', 'Lead Auto-Routing Rules', 'Dedicated Account Manager & 24/7 Support'],
    maxAgents: 9999, maxProperties: 99999, maxLeads: 999999, ...neutralLeadAllowanceDefaults(999999), hasCustomDomain: true, hasAdvancedAnalytics: true,
    hasWhatsAppIntegration: true, hasLeadAutomations: true, hasSmsAutomation: true, hasPremiumTemplates: true,
    maxStorageMb: 51200, maxMonthlyVisitors: 1000000, isPopular: false, isActive: true,
  },
]

const planWindowFilter = (at = new Date()) => ({
  isActive: true,
  effectiveFrom: { $lte: at },
  $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: at } }],
})

const ensureDefaults = async (): Promise<void> => {
  if (await SubscriptionPlan.exists({})) return
  const now = new Date()
  await SubscriptionPlan.insertMany(defaultPlans.map((plan) => mirrorPlanStatusWrite({
    ...normalizeEntitlementWrite(plan as Record<string, any>),
    version: 1,
    effectiveFrom: now,
    effectiveTo: null,
    changeReason: 'Initial Bangladesh production plan catalog',
  }, 'current', now)))
  await Cache.plans.del('catalog')
}

const getAllPlans = async (): Promise<ISubscriptionPlan[]> => {
  await ensureDefaults()
  const cached = await Cache.plans.get<ISubscriptionPlan[]>('catalog')
  if (cached) return cached.map((plan: any) => normalizeLeadAllowanceConfig(plan)) as ISubscriptionPlan[]
  const now = new Date()
  const rows = await SubscriptionPlan.find({ isCurrent: true, ...planWindowFilter(now) }).lean()
  const plans = rows
    .map((plan: any) => normalizeLeadAllowanceConfig(plan))
    .sort((a: any, b: any) => Number(a.tierRank) - Number(b.tierRank) || Number(a.priceMonthly) - Number(b.priceMonthly) || Number(b.version) - Number(a.version)) as ISubscriptionPlan[]
  await Cache.plans.set('catalog', plans, 300)
  return plans
}

const getPlanById = async (planId: string, version?: number): Promise<ISubscriptionPlan | null> => {
  await ensureDefaults()
  if (version) return SubscriptionPlan.findOne({ planId, version })
  return SubscriptionPlan.findOne({ planId, isCurrent: true, ...planWindowFilter(new Date()) }).sort({ version: -1 })
}

const getLatestPurchasablePlan = async (planId: string): Promise<ISubscriptionPlan | null> => {
  await ensureDefaults()
  const now = new Date()
  return SubscriptionPlan.findOne({
    planId,
    isCurrent: true,
    ...planWindowFilter(now),
  }).sort({ version: -1 })
}

const getAllPlanVersions = async (query: { planId?: string; currentOnly?: unknown; page?: unknown; limit?: unknown; sortBy?: unknown; sortOrder?: unknown } = {}) => {
  await ensureDefaults()
  const page = Math.max(1, Number(query.page || 1))
  const limit = Math.min(100, Math.max(1, Number(query.limit || 20)))
  const filter: any = query.planId ? { planId: query.planId } : {}
  if (String(query.currentOnly || '') === 'true') filter.isCurrent = true
  const allowed = new Set(['createdAt', 'effectiveFrom', 'version', 'planId', 'priceMonthly', 'tierRank', 'displayOrder', 'upgradeRank', 'status'])
  const sortBy = allowed.has(String(query.sortBy || '')) ? String(query.sortBy) : 'createdAt'
  const order: 1 | -1 = String(query.sortOrder || 'desc') === 'asc' ? 1 : -1
  const summaryFilter: any = query.planId ? { planId: query.planId } : {}
  const [data, total, summaryRows] = await Promise.all([
    SubscriptionPlan.find(filter).sort({ [sortBy]: order, _id: order }).skip((page - 1) * limit).limit(limit).lean(),
    SubscriptionPlan.countDocuments(filter),
    SubscriptionPlan.find(summaryFilter).select('status isActive isCurrent effectiveFrom').lean(),
  ])
  const summary = { current: 0, scheduled: 0, grandfathered: 0, retired: 0 }
  for (const row of summaryRows as any[]) summary[resolvePlanStatus(row)] += 1
  return { data: data.map((plan: any) => normalizeLeadAllowanceConfig(plan)), meta: { page, limit, total, totalPages: Math.ceil(total / limit), summary } }
}

const assertTierRankAvailable = async (planId: string, tierRank: number, session?: ClientSession) => {
  const query = SubscriptionPlan.find({ isCurrent: true, isActive: true, planId: { $ne: planId } })
    .select('planId tierRank upgradeRank displayOrder')
  if (session) query.session(session)
  const currentPlans: any[] = await query.lean()
  const conflict = currentPlans
    .map((plan) => resolvePlanOrdering(plan))
    .find((plan) => Number(plan.tierRank) === Number(tierRank))
  if (conflict) {
    throw new ApiError(httpStatus.CONFLICT, `Plan tier ${tierRank} is already used by ${conflict.planId}. Each current active plan family must have a unique tier.`)
  }
}

const createPlan = async (payload: Partial<ISubscriptionPlan>, actorId = ''): Promise<ISubscriptionPlan> => {
  await ensureDefaults()
  const planId = normalizePaidPlanId(payload.planId) as SubscriptionPlanId
  if (await SubscriptionPlan.exists({ planId })) {
    throw new ApiError(httpStatus.CONFLICT, 'This plan family already exists. Create a new version instead.')
  }
  await assertTierRankAvailable(planId, Number(payload.tierRank))
  const normalizedPayload = normalizePlanWrite(
    { ...payload, planId } as Record<string, any>,
    payload.entitlements,
  )
  validateLeadAllowanceConfig(normalizedPayload)
  const now = new Date()
  const result = await SubscriptionPlan.create(mirrorPlanStatusWrite({
    ...normalizedPayload,
    planId,
    version: 1,
    currency: 'BDT',
    effectiveFrom: now,
    effectiveTo: null,
    createdBy: actorId,
  }, 'current', now))
  await Cache.plans.del('catalog')
  return result
}

const createVersionWrites = async (id: string, payload: Partial<ISubscriptionPlan>, actorId: string, session?: ClientSession): Promise<ISubscriptionPlan> => {
  if (Object.prototype.hasOwnProperty.call(payload, 'planId')) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Plan ID is immutable. Create a different plan family if you need a new Plan ID.')
  }

  const currentQuery = SubscriptionPlan.findById(id)
  if (session) currentQuery.session(session)
  const current = await currentQuery
  if (!current) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found')
  if (resolvePlanStatus(current.toObject()) !== 'current') {
    throw new ApiError(httpStatus.CONFLICT, 'New versions can only be created from the current plan version')
  }

  const scheduledQuery = SubscriptionPlan.findOne({ planId: current.planId, status: 'scheduled', isActive: true })
  if (session) scheduledQuery.session(session)
  if (await scheduledQuery.lean()) {
    throw new ApiError(httpStatus.CONFLICT, 'This plan family already has a scheduled version. Retire that scheduled version before creating another version.')
  }

  const latestQuery = SubscriptionPlan.findOne({ planId: current.planId }).sort({ version: -1 }).lean()
  if (session) latestQuery.session(session)
  const latest = await latestQuery
  const now = new Date()
  const snapshot = current.toObject()
  const mergedCommercialSnapshot = normalizePlanWrite(
    { ...snapshot, ...payload, planId: current.planId },
    payload.entitlements,
  )
  validateLeadAllowanceConfig(mergedCommercialSnapshot)
  await assertTierRankAvailable(String(current.planId), Number(mergedCommercialSnapshot.tierRank), session)
  const nextVersion = (latest?.version || current.version || 1) + 1

  current.status = 'grandfathered'
  current.isCurrent = false
  current.isActive = true
  current.effectiveTo = now
  current.grandfatherExisting = true
  current.migrationAppliedAt = current.migrationAppliedAt || now
  await current.save(session ? { session } : undefined)

  const docs = await SubscriptionPlan.create([mirrorPlanStatusWrite({
    ...snapshot,
    ...mergedCommercialSnapshot,
    _id: undefined,
    __v: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    planId: current.planId,
    version: nextVersion,
    currency: 'BDT',
    effectiveFrom: now,
    effectiveTo: null,
    createdBy: actorId,
    changeReason: payload.changeReason || '',
  }, 'current', now)], session ? { session } : undefined)
  return docs[0]
}

const createVersion = async (id: string, payload: Partial<ISubscriptionPlan>, actorId = ''): Promise<ISubscriptionPlan> => {
  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    let created: ISubscriptionPlan | undefined
    try {
      await session.withTransaction(async () => { created = await createVersionWrites(id, payload, actorId, session) })
      if (!created) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create subscription plan version')
      await Cache.plans.del('catalog')
      return created
    } finally {
      await session.endSession()
    }
  }
  if (config.env === 'production') {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Plan version changes require a MongoDB replica set or mongos in production')
  }
  // Local standalone fallback. The production path above is transactional.
  const previous = await SubscriptionPlan.findById(id).lean()
  try {
    const created = await createVersionWrites(id, payload, actorId)
    await Cache.plans.del('catalog')
    return created
  } catch (error) {
    if (previous) await SubscriptionPlan.replaceOne({ _id: id }, previous).catch(() => undefined)
    throw error
  }
}

const archivePlan = async (id: string): Promise<ISubscriptionPlan> => {
  const plan = await SubscriptionPlan.findById(id)
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found')
  const status = resolvePlanStatus(plan.toObject())
  if (status === 'current') {
    throw new ApiError(httpStatus.CONFLICT, 'The current plan version cannot be retired. Create its replacement version first.')
  }
  if (status === 'retired') return plan

  const tenantCount = await Organization.countDocuments({ 'subscription.plan': plan.planId, 'subscription.planVersion': plan.version })
  if (tenantCount > 0) {
    throw new ApiError(httpStatus.CONFLICT, `This plan version is still assigned to ${tenantCount} tenant(s) and cannot be retired`)
  }
  const now = new Date()
  plan.status = 'retired'
  plan.isActive = false
  plan.isCurrent = false
  plan.grandfatherExisting = true
  plan.effectiveTo = plan.effectiveTo || now
  await plan.save()
  await Cache.plans.del('catalog')
  return plan
}

const activateScheduledPlanVersionWrites = async (id: string, session?: ClientSession): Promise<boolean> => {
  const scheduledQuery = SubscriptionPlan.findById(id)
  if (session) scheduledQuery.session(session)
  const scheduled = await scheduledQuery
  if (!scheduled || resolvePlanStatus(scheduled.toObject()) !== 'scheduled' || new Date(scheduled.effectiveFrom).getTime() > Date.now()) return false

  await assertTierRankAvailable(String(scheduled.planId), Number(resolvePlanOrdering(scheduled.toObject()).tierRank), session)
  const currentQuery = SubscriptionPlan.findOne({ planId: scheduled.planId, isCurrent: true, _id: { $ne: scheduled._id } })
  if (session) currentQuery.session(session)
  const current = await currentQuery
  const activatedAt = new Date(scheduled.effectiveFrom)

  if (current) {
    current.status = 'grandfathered'
    current.isCurrent = false
    current.isActive = true
    current.grandfatherExisting = true
    current.effectiveTo = activatedAt
    current.migrationAppliedAt = current.migrationAppliedAt || activatedAt
    await current.save(session ? { session } : undefined)
  }

  scheduled.status = 'current'
  scheduled.isCurrent = true
  scheduled.isActive = true
  scheduled.grandfatherExisting = true
  scheduled.effectiveTo = null
  scheduled.migrationAppliedAt = scheduled.migrationAppliedAt || activatedAt
  await scheduled.save(session ? { session } : undefined)
  return true
}

const activateDueScheduledPlanVersions = async (): Promise<number> => {
  const due = await SubscriptionPlan.find({ status: 'scheduled', isActive: true, effectiveFrom: { $lte: new Date() } })
    .sort({ effectiveFrom: 1, version: 1 })
    .select('_id')
    .limit(50)
    .lean()
  if (!due.length) return 0

  const transactional = await mongoSupportsTransactions()
  if (!transactional && config.env === 'production') {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Scheduled plan activation requires a MongoDB replica set or mongos in production')
  }

  let activated = 0
  for (const row of due) {
    if (transactional) {
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          if (await activateScheduledPlanVersionWrites(String(row._id), session)) activated += 1
        })
      } finally {
        await session.endSession()
      }
    } else if (await activateScheduledPlanVersionWrites(String(row._id))) {
      activated += 1
    }
  }
  if (activated) await Cache.plans.del('catalog')
  return activated
}

const applyDuePlanVersions = async (): Promise<{ activatedVersions: number; appliedVersions: number; migratedTenants: number }> => {
  const activatedVersions = await activateDueScheduledPlanVersions()
  // Compatibility-only path for legacy pre-Phase-2 versions that explicitly opted into tenant migration.
  const due = await SubscriptionPlan.find({
    grandfatherExisting: false,
    migrationAppliedAt: null,
    effectiveFrom: { $lte: new Date() },
    isActive: true,
    status: { $ne: 'scheduled' },
  }).sort({ effectiveFrom: 1 }).limit(50)

  let migratedTenants = 0
  for (const plan of due) {
    const tenants = await Organization.find({
      'subscription.plan': plan.planId,
      $or: [{ 'subscription.planVersion': { $exists: false } }, { 'subscription.planVersion': { $ne: plan.version } }],
    }).select('organizationId').lean()

    for (const tenant of tenants) {
      let reconciliation: SubscriptionEntitlementReconciliationResult | null = null
      const migrated = await EntitlementService.withTeamMemberQuotaGuard(tenant.organizationId, async (session) => {
        const currentQuery = Organization.findOne({ organizationId: tenant.organizationId }).select('subscription')
        if (session) currentQuery.session(session)
        const current: any = await currentQuery.lean()
        const result = await Organization.updateOne(
          {
            organizationId: tenant.organizationId,
            'subscription.plan': plan.planId,
            $or: [{ 'subscription.planVersion': { $exists: false } }, { 'subscription.planVersion': { $ne: plan.version } }],
          },
          { $set: {
            'subscription.planVersion': plan.version,
            'subscription.maxProperties': plan.maxProperties,
            'subscription.maxAgents': plan.maxAgents,
          } },
          session ? { session } : undefined,
        )
        if (!result.modifiedCount) return false
        reconciliation = await reconcileOrganizationEntitlements(tenant.organizationId, current?.subscription, plan, {
          session,
          actorId: 'system:plan-version-worker',
          reason: `Subscription plan version migrated to ${plan.planId} v${plan.version}`,
        })
        return true
      })
      if (migrated) {
        migratedTenants += 1
        await publishSubscriptionEntitlementReconciliation(reconciliation)
      }
    }

    plan.migrationAppliedAt = new Date()
    await plan.save()
  }
  if (due.length) await Cache.plans.del('catalog')
  return { activatedVersions, appliedVersions: due.length, migratedTenants }
}

export const SubscriptionPlanService = {
  getAllPlans,
  getPlanById,
  getLatestPurchasablePlan,
  getAllPlanVersions,
  createPlan,
  createVersion,
  updatePlan: createVersion,
  deletePlan: archivePlan,
  activateDueScheduledPlanVersions,
  applyDuePlanVersions,
}
