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
  const entitlementResolved = resolveEntitlementSource(plan)
  // Preserve legacy Starter fallbacks for old documents that pre-date the loyalty fields,
  // but never force Professional/Agency bonuses to zero when the immutable plan version
  // explicitly enables them.
  const fallback = entitlementResolved.planId === 'starter'
    ? starterLeadAllowanceDefaults
    : neutralLeadAllowanceDefaults(entitlementResolved.maxLeads)
  const leadAllowanceModel = entitlementResolved.leadAllowanceModel === 'active_capacity' ? 'active_capacity' : 'paid_period_credits'
  return {
    ...entitlementResolved,
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

const defaultPlans: Array<Omit<Partial<ISubscriptionPlan>, 'planId'> & { planId: SubscriptionPlanId }> = [
  {
    planId: 'starter', name: 'Starter', priceMonthly: 500, priceYearly: 5000, currency: 'BDT',
    description: 'Perfect for solo real estate agents and boutique teams starting out.',
    features: ['1–3 Team Agents', '100 Property Listings', '200 Leads / Paid Month', '+50 Leads per Consecutive Renewal', 'Up to 500 Active Pipeline Leads', 'Public Agency Website', 'Basic CRM & Activity Feed', 'Agency Subdomain', 'Standard Support'],
    maxAgents: 3, maxProperties: 100, maxLeads: 500, ...starterLeadAllowanceDefaults, hasCustomDomain: false, hasAdvancedAnalytics: false,
    hasWhatsAppIntegration: false, hasLeadAutomations: false, hasSmsAutomation: false, hasPremiumTemplates: false,
    maxStorageMb: 1024, maxMonthlyVisitors: 10000, isPopular: false, isActive: true,
  },
  {
    planId: 'professional', name: 'Professional', priceMonthly: 3490, priceYearly: 34900, currency: 'BDT',
    description: 'Designed for high-growth real estate teams and established agencies.',
    features: ['Up to 10 Team Agents', '1,000 Property Listings', 'Unlimited Leads & Deals', 'Custom Domain (www.agency.com)', 'Advanced Lead Pipeline & Kanban', 'Viewing Calendar & Booking', 'Advanced Real Estate Analytics', 'Priority Email Support'],
    maxAgents: 10, maxProperties: 1000, maxLeads: 10000, ...neutralLeadAllowanceDefaults(10000), hasCustomDomain: true, hasAdvancedAnalytics: true,
    hasWhatsAppIntegration: true, hasLeadAutomations: true, hasSmsAutomation: true, hasPremiumTemplates: true,
    maxStorageMb: 10240, maxMonthlyVisitors: 100000, isPopular: true, isActive: true,
  },
  {
    planId: 'agency', name: 'Agency Scale', priceMonthly: 6990, priceYearly: 69900, currency: 'BDT',
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
  await SubscriptionPlan.insertMany(defaultPlans.map((plan) => ({
    ...normalizeEntitlementWrite(plan as Record<string, any>),
    version: 1,
    isCurrent: true,
    effectiveFrom: now,
    effectiveTo: null,
    grandfatherExisting: true,
    migrationAppliedAt: now,
    changeReason: 'Initial Bangladesh production plan catalog',
  })))
  await Cache.plans.del('catalog')
}

const getAllPlans = async (): Promise<ISubscriptionPlan[]> => {
  await ensureDefaults()
  const cached = await Cache.plans.get<ISubscriptionPlan[]>('catalog')
  if (cached) return cached.map((plan: any) => normalizeLeadAllowanceConfig(plan)) as ISubscriptionPlan[]
  const now = new Date()
  const rows = await SubscriptionPlan.find(planWindowFilter(now)).sort({ priceMonthly: 1, version: -1 }).lean()
  const plans = rows.map((plan: any) => normalizeLeadAllowanceConfig(plan)) as ISubscriptionPlan[]
  await Cache.plans.set('catalog', plans, 300)
  return plans
}

const getPlanById = async (planId: string, version?: number): Promise<ISubscriptionPlan | null> => {
  await ensureDefaults()
  if (version) return SubscriptionPlan.findOne({ planId, version })
  return SubscriptionPlan.findOne({ planId, ...planWindowFilter(new Date()) }).sort({ version: -1 })
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
  const allowed = new Set(['createdAt', 'effectiveFrom', 'version', 'planId', 'priceMonthly'])
  const sortBy = allowed.has(String(query.sortBy || '')) ? String(query.sortBy) : 'createdAt'
  const order: 1 | -1 = String(query.sortOrder || 'desc') === 'asc' ? 1 : -1
  const summaryFilter: any = query.planId ? { planId: query.planId } : {}
  const now = new Date()
  const [data, total, grandfathered, scheduled] = await Promise.all([
    SubscriptionPlan.find(filter).sort({ [sortBy]: order, _id: order }).skip((page - 1) * limit).limit(limit).lean(),
    SubscriptionPlan.countDocuments(filter),
    SubscriptionPlan.countDocuments({ ...summaryFilter, grandfatherExisting: true }),
    SubscriptionPlan.countDocuments({ ...summaryFilter, effectiveFrom: { $gt: now } }),
  ])
  return { data: data.map((plan: any) => normalizeLeadAllowanceConfig(plan)), meta: { page, limit, total, totalPages: Math.ceil(total / limit), summary: { grandfathered, scheduled } } }
}

const createPlan = async (payload: Partial<ISubscriptionPlan>, actorId = ''): Promise<ISubscriptionPlan> => {
  await ensureDefaults()
  const planId = payload.planId as SubscriptionPlanId
  if (await SubscriptionPlan.exists({ planId })) {
    throw new ApiError(httpStatus.CONFLICT, 'This plan family already exists. Create a new version instead.')
  }
  const entitlementNormalized = normalizeEntitlementWrite(
    { ...payload, planId } as Record<string, any>,
    payload.entitlements,
  )
  const normalizedPayload = normalizeLeadAllowanceConfig(entitlementNormalized)
  validateLeadAllowanceConfig(normalizedPayload)
  const result = await SubscriptionPlan.create({
    ...normalizedPayload,
    planId,
    version: 1,
    currency: 'BDT',
    isCurrent: true,
    effectiveFrom: payload.effectiveFrom || new Date(),
    effectiveTo: null,
    grandfatherExisting: payload.grandfatherExisting ?? true,
    migrationAppliedAt: payload.grandfatherExisting === false ? null : new Date(),
    createdBy: actorId,
  })
  await Cache.plans.del('catalog')
  return result
}

const createVersionWrites = async (id: string, payload: Partial<ISubscriptionPlan>, actorId: string, session?: ClientSession): Promise<ISubscriptionPlan> => {
  const currentQuery = SubscriptionPlan.findById(id)
  if (session) currentQuery.session(session)
  const current = await currentQuery
  if (!current) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found')

  const latestQuery = SubscriptionPlan.findOne({ planId: current.planId }).sort({ version: -1 }).lean()
  if (session) latestQuery.session(session)
  const latest = await latestQuery
  const effectiveFrom = payload.effectiveFrom ? new Date(payload.effectiveFrom) : new Date()
  if (Number.isNaN(effectiveFrom.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid effective date')

  const snapshot = current.toObject()
  const mergedRawSnapshot = { ...snapshot, ...payload, planId: current.planId }
  const entitlementNormalized = normalizeEntitlementWrite(
    mergedRawSnapshot,
    payload.entitlements,
  )
  const mergedCommercialSnapshot = normalizeLeadAllowanceConfig(entitlementNormalized)
  validateLeadAllowanceConfig(mergedCommercialSnapshot)
  const nextVersion = (latest?.version || current.version || 1) + 1
  const grandfatherExisting = payload.grandfatherExisting ?? true

  await SubscriptionPlan.updateMany({ planId: current.planId, isCurrent: true }, { $set: { isCurrent: false } }, session ? { session } : undefined)
  const previousQuery = SubscriptionPlan.findOne({
    planId: current.planId,
    effectiveFrom: { $lte: effectiveFrom },
    $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: effectiveFrom } }],
  }).sort({ version: -1 })
  if (session) previousQuery.session(session)
  const previousEffective = await previousQuery
  if (previousEffective) {
    previousEffective.effectiveTo = effectiveFrom
    await previousEffective.save(session ? { session } : undefined)
  }

  const docs = await SubscriptionPlan.create([{
    ...snapshot,
    ...mergedCommercialSnapshot,
    _id: undefined,
    __v: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    planId: current.planId,
    version: nextVersion,
    currency: 'BDT',
    isCurrent: true,
    effectiveFrom,
    effectiveTo: null,
    grandfatherExisting,
    migrationAppliedAt: grandfatherExisting ? new Date() : null,
    createdBy: actorId,
    changeReason: payload.changeReason || '',
  }], session ? { session } : undefined)
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
  // Local standalone MongoDB fallback. Production deliberately fails closed above
  // because plan versioning is a multi-document commercial mutation.
  try {
    const created = await createVersionWrites(id, payload, actorId)
    await Cache.plans.del('catalog')
    return created
  } catch (error) {
    await SubscriptionPlan.updateOne({ _id: id }, { $set: { isCurrent: true } }).catch(() => undefined)
    throw error
  }
}

const archivePlan = async (id: string): Promise<ISubscriptionPlan> => {
  const plan = await SubscriptionPlan.findById(id)
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription plan not found')
  const tenantCount = await Organization.countDocuments({ 'subscription.plan': plan.planId, 'subscription.planVersion': plan.version })
  if (tenantCount > 0) {
    throw new ApiError(httpStatus.CONFLICT, `This plan version is still assigned to ${tenantCount} tenant(s) and cannot be archived`)
  }
  plan.isActive = false
  plan.isCurrent = false
  plan.effectiveTo = plan.effectiveTo || new Date()
  await plan.save()
  await Cache.plans.del('catalog')
  return plan
}

const applyDuePlanVersions = async (): Promise<{ appliedVersions: number; migratedTenants: number }> => {
  const due = await SubscriptionPlan.find({
    grandfatherExisting: false,
    migrationAppliedAt: null,
    effectiveFrom: { $lte: new Date() },
    isActive: true,
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
  return { appliedVersions: due.length, migratedTenants }
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
  applyDuePlanVersions,
}
