import httpStatus from 'http-status'
import mongoose, { ClientSession } from 'mongoose'
import config from '../../../config'
import { Cache } from '../../../shared/cache'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import ApiError from '../../../errors/ApiError'
import { Organization } from '../organization/organization.model'
import { ISubscriptionPlan, SubscriptionPlanId } from './subscriptionPlan.interface'
import { SubscriptionPlan } from './subscriptionPlan.model'

const defaultPlans: Array<Omit<Partial<ISubscriptionPlan>, 'planId'> & { planId: SubscriptionPlanId }> = [
  {
    planId: 'starter', name: 'Starter', priceMonthly: 1490, priceYearly: 14900, currency: 'BDT',
    description: 'Perfect for solo real estate agents and boutique teams starting out.',
    features: ['1–3 Team Agents', '100 Property Listings', '500 Active Leads', 'Public Agency Website', 'Basic CRM & Activity Feed', 'Agency Subdomain', 'Standard Support'],
    maxAgents: 3, maxProperties: 100, maxLeads: 500, hasCustomDomain: false, hasAdvancedAnalytics: false,
    hasWhatsAppIntegration: false, hasLeadAutomations: false, hasSmsAutomation: false, hasPremiumTemplates: false,
    maxStorageMb: 1024, maxMonthlyVisitors: 10000, isPopular: false, isActive: true,
  },
  {
    planId: 'professional', name: 'Professional', priceMonthly: 3490, priceYearly: 34900, currency: 'BDT',
    description: 'Designed for high-growth real estate teams and established agencies.',
    features: ['Up to 10 Team Agents', '1,000 Property Listings', 'Unlimited Leads & Deals', 'Custom Domain (www.agency.com)', 'Advanced Lead Pipeline & Kanban', 'Viewing Calendar & Booking', 'Advanced Real Estate Analytics', 'Priority Email Support'],
    maxAgents: 10, maxProperties: 1000, maxLeads: 10000, hasCustomDomain: true, hasAdvancedAnalytics: true,
    hasWhatsAppIntegration: true, hasLeadAutomations: true, hasSmsAutomation: true, hasPremiumTemplates: true,
    maxStorageMb: 10240, maxMonthlyVisitors: 100000, isPopular: true, isActive: true,
  },
  {
    planId: 'agency', name: 'Agency Scale', priceMonthly: 6990, priceYearly: 69900, currency: 'BDT',
    description: 'Full-featured enterprise platform for large brokerages and multi-office firms.',
    features: ['Unlimited Team Agents', 'Unlimited Property Listings', 'Unlimited Leads & Contacts', 'Custom Domain + Multi-Branch', 'WhatsApp Integration & SMS Marketing', 'Agent Performance Leaderboards', 'Lead Auto-Routing Rules', 'Dedicated Account Manager & 24/7 Support'],
    maxAgents: 9999, maxProperties: 99999, maxLeads: 999999, hasCustomDomain: true, hasAdvancedAnalytics: true,
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
    ...plan,
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
  if (cached) return cached
  const now = new Date()
  const plans = await SubscriptionPlan.find(planWindowFilter(now)).sort({ priceMonthly: 1, version: -1 }).lean()
  await Cache.plans.set('catalog', plans, 300)
  return plans as ISubscriptionPlan[]
}

const getPlanById = async (planId: string, version?: number): Promise<ISubscriptionPlan | null> => {
  await ensureDefaults()
  if (version) return SubscriptionPlan.findOne({ planId, version })
  return SubscriptionPlan.findOne({ planId, ...planWindowFilter(new Date()) }).sort({ version: -1 })
}

const getAllPlanVersions = async (planId?: string) => {
  await ensureDefaults()
  return SubscriptionPlan.find(planId ? { planId } : {}).sort({ planId: 1, version: -1 }).lean()
}

const createPlan = async (payload: Partial<ISubscriptionPlan>, actorId = ''): Promise<ISubscriptionPlan> => {
  await ensureDefaults()
  const planId = payload.planId as SubscriptionPlanId
  if (await SubscriptionPlan.exists({ planId })) {
    throw new ApiError(httpStatus.CONFLICT, 'This plan family already exists. Create a new version instead.')
  }
  const result = await SubscriptionPlan.create({
    ...payload,
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
    _id: undefined,
    __v: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    ...payload,
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
    const result = await Organization.updateMany(
      { 'subscription.plan': plan.planId, $or: [{ 'subscription.planVersion': { $exists: false } }, { 'subscription.planVersion': { $ne: plan.version } }] },
      { $set: {
        'subscription.planVersion': plan.version,
        'subscription.maxProperties': plan.maxProperties,
        'subscription.maxAgents': plan.maxAgents,
      } },
    )
    migratedTenants += result.modifiedCount
    plan.migrationAppliedAt = new Date()
    await plan.save()
  }
  if (due.length) await Cache.plans.del('catalog')
  return { appliedVersions: due.length, migratedTenants }
}

export const SubscriptionPlanService = {
  getAllPlans,
  getPlanById,
  getAllPlanVersions,
  createPlan,
  createVersion,
  updatePlan: createVersion,
  deletePlan: archivePlan,
  applyDuePlanVersions,
}
