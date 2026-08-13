import ApiError from '../../../errors/ApiError'
import { Lead } from '../lead/lead.model'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { SubscriptionPlan } from '../subscriptionPlan/subscriptionPlan.model'
import { User } from '../user/user.model'

type Feature = 'customDomain' | 'advancedAnalytics' | 'whatsAppAutomation' | 'smsAutomation' | 'premiumTemplates'
export const trialEntitlements = { maxAgents: 2, maxProperties: 10, maxLeads: 100, maxStorageMb: 512, maxMonthlyVisitors: 5000,
  hasCustomDomain: false, hasAdvancedAnalytics: false, hasWhatsAppIntegration: false, hasSmsAutomation: false, hasPremiumTemplates: false }

const resolve = async (organizationId: string) => {
  const organization = await Organization.findOne({ organizationId })
  if (!organization || organization.isBlocked) throw new ApiError(403, 'Organization is unavailable')
  if (!['trialing', 'active', 'grace', 'cancel_at_period_end'].includes(organization.subscription.status)) {
    throw new ApiError(402, `Subscription is ${organization.subscription.status}`)
  }
  let plan = null as any
  if (organization.subscription.plan !== 'trial') {
    const exactVersion = organization.subscription.planVersion
      ? await SubscriptionPlan.findOne({ planId: organization.subscription.plan, version: organization.subscription.planVersion }).lean()
      : null
    plan = exactVersion || await SubscriptionPlan.findOne({
      planId: organization.subscription.plan,
      isActive: true,
      effectiveFrom: { $lte: new Date() },
      $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: new Date() } }],
    }).sort({ version: -1 }).lean()
  }
  return { organization, limits: { ...trialEntitlements, ...(plan || {}), maxAgents: organization.subscription.maxAgents || plan?.maxAgents || trialEntitlements.maxAgents,
    maxProperties: organization.subscription.maxProperties || plan?.maxProperties || trialEntitlements.maxProperties } }
}

export const wouldExceedEntitlementLimit = (usage: number, maximum: number, increment = 1): boolean => usage + increment > maximum

const assertLimit = async (organizationId: string, resource: 'properties' | 'agents' | 'leads', increment = 1): Promise<void> => {
  const { limits } = await resolve(organizationId)
  const [usage, maximum] = resource === 'properties'
    ? [await Property.countDocuments({ organizationId, status: { $ne: 'Archived' } }), limits.maxProperties]
    : resource === 'agents'
      ? [await User.countDocuments({ organizationId, status: { $ne: 'blocked' }, userRole: { $in: ['agency_owner', 'agency_admin', 'agent'] } }), limits.maxAgents]
      : [await Lead.countDocuments({ organizationId, leadStatus: { $nin: ['Won', 'Lost'] } }), limits.maxLeads]
  if (wouldExceedEntitlementLimit(usage, maximum, increment)) throw new ApiError(402, `${resource} limit reached (${usage}/${maximum}). Existing data was not removed.`)
}

export const featureEnabled = (limits: Record<string, any>, feature: Feature): boolean => {
  const mapping: Record<Feature, boolean> = {
    customDomain: Boolean(limits.hasCustomDomain),
    advancedAnalytics: Boolean(limits.hasAdvancedAnalytics),
    whatsAppAutomation: Boolean(limits.hasWhatsAppIntegration),
    smsAutomation: Boolean(limits.hasSmsAutomation),
    premiumTemplates: Boolean(limits.hasPremiumTemplates),
  }
  return mapping[feature]
}

const assertFeature = async (organizationId: string, feature: Feature): Promise<void> => {
  const { limits } = await resolve(organizationId)
  if (!featureEnabled(limits, feature)) throw new ApiError(402, `${feature} is not included in the current plan`)
}

const assertStorage = async (organizationId: string, additionalBytes: number): Promise<void> => {
  const { organization, limits } = await resolve(organizationId)
  if ((organization.storageUsedBytes || 0) + additionalBytes > limits.maxStorageMb * 1024 * 1024) throw new ApiError(402, 'Storage quota exceeded')
}

const consumeVisitor = async (organizationId: string): Promise<void> => {
  const { organization, limits } = await resolve(organizationId)
  const month = new Date().toISOString().slice(0, 7)
  if (organization.visitorUsageMonth !== month) {
    await Organization.updateOne({ organizationId }, { visitorUsageMonth: month, monthlyVisitorCount: 0 })
  }
  const updated = await Organization.findOneAndUpdate({ organizationId, monthlyVisitorCount: { $lt: limits.maxMonthlyVisitors } },
    { $inc: { monthlyVisitorCount: 1, totalVisitor: 1 } }, { new: true })
  if (!updated) throw new ApiError(429, 'Monthly visitor quota reached')
}

export const EntitlementService = { resolve, assertLimit, assertFeature, assertStorage, consumeVisitor }
