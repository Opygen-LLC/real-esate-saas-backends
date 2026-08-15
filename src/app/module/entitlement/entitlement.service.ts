import ApiError from '../../../errors/ApiError'
import { Lead } from '../lead/lead.model'
import { Organization } from '../organization/organization.model'
import { getTrialPolicy } from '../platformSettings/trialPolicy.service'
import { Property } from '../property/property.model'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { User } from '../user/user.model'

type Feature = 'customDomain' | 'advancedAnalytics' | 'whatsAppAutomation' | 'smsAutomation' | 'premiumTemplates' | 'leadAutomations'
type LimitedResource = 'properties' | 'agents' | 'leads'

const activePlanFilter = () => ({
  isActive: true,
  effectiveFrom: { $lte: new Date() },
  $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: new Date() } }],
})

const trialLimits = async () => {
  const policy = await getTrialPolicy()
  return {
    maxAgents: policy.maxAgents,
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
  maxAgents: 2,
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

const resolve = async (organizationId: string) => {
  const organization = await Organization.findOne({ organizationId })
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
    const exactVersion = organization.subscription.planVersion
      ? await SubscriptionPlan.findOne({ planId: organization.subscription.plan, version: organization.subscription.planVersion }).lean()
      : null
    plan = exactVersion || await SubscriptionPlan.findOne({
      planId: organization.subscription.plan,
      ...activePlanFilter(),
    }).sort({ version: -1 }).lean()
  }

  return {
    organization,
    limits: {
      ...baseTrial,
      ...(plan || {}),
      maxAgents: organization.subscription.maxAgents ?? plan?.maxAgents ?? baseTrial.maxAgents,
      maxProperties: organization.subscription.maxProperties ?? plan?.maxProperties ?? baseTrial.maxProperties,
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
  const field = resource === 'properties' ? 'maxProperties' : resource === 'agents' ? 'maxAgents' : 'maxLeads'
  const plan = await SubscriptionPlan.findOne({ ...activePlanFilter(), [field]: { $gte: required } }).sort({ priceMonthly: 1, version: -1 }).select('planId').lean()
  return plan?.planId || null
}

const assertLimit = async (organizationId: string, resource: LimitedResource, increment = 1): Promise<void> => {
  const { organization, limits } = await resolve(organizationId)
  const [usage, maximum] = resource === 'properties'
    ? [await Property.countDocuments({ organizationId, status: { $ne: 'Archived' } }), limits.maxProperties]
    : resource === 'agents'
      ? [await User.countDocuments({ organizationId, status: { $ne: 'blocked' }, userRole: { $in: ['agency_owner', 'agency_admin', 'agent', 'staff'] } }), limits.maxAgents]
      : [await Lead.countDocuments({ organizationId, leadStatus: { $nin: ['Won', 'Lost'] } }), limits.maxLeads]

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

export const EntitlementService = { resolve, assertLimit, assertFeature, hasFeature, assertStorage, consumeVisitor }
