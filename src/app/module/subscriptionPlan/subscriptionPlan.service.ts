import { ISubscriptionPlan } from './subscriptionPlan.interface'
import { SubscriptionPlan } from './subscriptionPlan.model'

const defaultPlans: Partial<ISubscriptionPlan>[] = [
  {
    planId: 'starter',
    name: 'Starter',
    priceMonthly: 1490,
    priceYearly: 14900,
    currency: 'BDT',
    description: 'Perfect for solo real estate agents and boutique teams starting out.',
    features: [
      '1–3 Team Agents',
      '100 Property Listings',
      '500 Active Leads',
      'Public Agency Website',
      'Basic CRM & Activity Feed',
      'Agency Subdomain',
      'Standard Support',
    ],
    maxAgents: 3,
    maxProperties: 100,
    maxLeads: 500,
    hasCustomDomain: false,
    hasAdvancedAnalytics: false,
    hasWhatsAppIntegration: false,
    hasLeadAutomations: false,
    hasSmsAutomation: false,
    hasPremiumTemplates: false,
    maxStorageMb: 1024,
    maxMonthlyVisitors: 10000,
    isPopular: false,
    isActive: true,
  },
  {
    planId: 'professional',
    name: 'Professional',
    priceMonthly: 3490,
    priceYearly: 34900,
    currency: 'BDT',
    description: 'Designed for high-growth real estate teams and established agencies.',
    features: [
      'Up to 10 Team Agents',
      '1,000 Property Listings',
      'Unlimited Leads & Deals',
      'Custom Domain (www.agency.com)',
      'Advanced Lead Pipeline & Kanban',
      'Viewing Calendar & Booking',
      'Advanced Real Estate Analytics',
      'Priority Email Support',
    ],
    maxAgents: 10,
    maxProperties: 1000,
    maxLeads: 10000,
    hasCustomDomain: true,
    hasAdvancedAnalytics: true,
    hasWhatsAppIntegration: true,
    hasLeadAutomations: true,
    hasSmsAutomation: true,
    hasPremiumTemplates: true,
    maxStorageMb: 10240,
    maxMonthlyVisitors: 100000,
    isPopular: true,
    isActive: true,
  },
  {
    planId: 'agency',
    name: 'Agency Scale',
    priceMonthly: 6990,
    priceYearly: 69900,
    currency: 'BDT',
    description: 'Full-featured enterprise platform for large brokerages and multi-office firms.',
    features: [
      'Unlimited Team Agents',
      'Unlimited Property Listings',
      'Unlimited Leads & Contacts',
      'Custom Domain + Multi-Branch',
      'WhatsApp Integration & SMS Marketing',
      'Agent Performance Leaderboards',
      'Lead Auto-Routing Rules',
      'Dedicated Account Manager & 24/7 Support',
    ],
    maxAgents: 9999,
    maxProperties: 99999,
    maxLeads: 999999,
    hasCustomDomain: true,
    hasAdvancedAnalytics: true,
    hasWhatsAppIntegration: true,
    hasLeadAutomations: true,
    hasSmsAutomation: true,
    hasPremiumTemplates: true,
    maxStorageMb: 51200,
    maxMonthlyVisitors: 1000000,
    isPopular: false,
    isActive: true,
  },
]

const getAllPlans = async (): Promise<ISubscriptionPlan[]> => {
  let plans = await SubscriptionPlan.find({ isActive: true }).sort({ priceMonthly: 1 })
  if (!plans || plans.length === 0) {
    await SubscriptionPlan.insertMany(defaultPlans)
    plans = await SubscriptionPlan.find({ isActive: true }).sort({ priceMonthly: 1 })
  }
  return plans
}

const getPlanById = async (planId: string): Promise<ISubscriptionPlan | null> => {
  return await SubscriptionPlan.findOne({ planId })
}

const createPlan = async (payload: ISubscriptionPlan): Promise<ISubscriptionPlan> => {
  const result = await SubscriptionPlan.create(payload)
  return result
}

const updatePlan = async (id: string, payload: Partial<ISubscriptionPlan>): Promise<ISubscriptionPlan | null> => {
  const result = await SubscriptionPlan.findByIdAndUpdate(id, payload, { new: true })
  return result
}

const deletePlan = async (id: string): Promise<ISubscriptionPlan | null> => {
  const result = await SubscriptionPlan.findByIdAndDelete(id)
  return result
}

export const SubscriptionPlanService = {
  getAllPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
}
