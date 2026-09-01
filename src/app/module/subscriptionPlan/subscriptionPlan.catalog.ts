import type { SubscriptionPlanId } from './subscriptionPlan.interface'

export interface CurrentPlanCatalogEntry {
  planId: SubscriptionPlanId
  name: string
  tierRank: number
  priceMonthly: number
  priceYearly: number
  teamMembers: number
  maxProperties: number
  baseLeadCapacity: number
  maxAddonLeadCapacity: number | null
  storageMb: number
  monthlyVisitors: number
  description: string
  marketingFeatures: readonly string[]
  features: {
    customDomain: boolean
    advancedAnalytics: boolean
    whatsappIntegration: boolean
    leadAutomation: boolean
    smsAutomation: boolean
    premiumTemplates: boolean
    advancedAccounting: boolean
  }
  isPopular: boolean
}

/**
 * Phase 5 authoritative catalog for fresh environments.
 *
 * Historical migrations deliberately do not import this file: their commercial
 * snapshots must remain immutable. Runtime bootstrap/seed code is the only place
 * that should use this catalog to create the initial current versions.
 */
export const CURRENT_PLAN_CATALOG = {
  starter: {
    planId: 'starter',
    name: 'Starter',
    tierRank: 10,
    priceMonthly: 500,
    priceYearly: 5_000,
    teamMembers: 3,
    maxProperties: 10,
    baseLeadCapacity: 200,
    maxAddonLeadCapacity: 2_000,
    storageMb: 1_024,
    monthlyVisitors: 10_000,
    description: 'A simple starting plan for small real estate teams.',
    marketingFeatures: [
      'Up to 3 Team Members',
      '10 Property Listings',
      '200 Active CRM Leads',
      'Public Agency Website',
      'Basic CRM & Activity Feed',
      'Agency Subdomain',
      'Standard Support',
    ],
    features: {
      customDomain: false,
      advancedAnalytics: false,
      whatsappIntegration: false,
      leadAutomation: false,
      smsAutomation: false,
      premiumTemplates: false,
      advancedAccounting: false,
    },
    isPopular: false,
  },
  professional: {
    planId: 'professional',
    name: 'Professional',
    tierRank: 20,
    priceMonthly: 1_000,
    priceYearly: 10_000,
    teamMembers: 5,
    maxProperties: 25,
    baseLeadCapacity: 800,
    maxAddonLeadCapacity: 5_000,
    storageMb: 1_024,
    monthlyVisitors: 100_000,
    description: 'More capacity and premium tools for growing real estate teams.',
    marketingFeatures: [
      'Up to 5 Team Members',
      '25 Property Listings',
      '800 Active CRM Leads',
      'Custom Domain',
      'Advanced Analytics',
      'WhatsApp Integration',
      'Lead Automations',
      'Priority Support',
    ],
    features: {
      customDomain: true,
      advancedAnalytics: true,
      whatsappIntegration: true,
      leadAutomation: true,
      smsAutomation: false,
      premiumTemplates: true,
      advancedAccounting: false,
    },
    isPopular: true,
  },
  agency: {
    planId: 'agency',
    name: 'Agency Scale',
    tierRank: 30,
    priceMonthly: 1_500,
    priceYearly: 15_000,
    teamMembers: 10,
    maxProperties: 50,
    baseLeadCapacity: 2_000,
    maxAddonLeadCapacity: 20_000,
    storageMb: 5_120,
    monthlyVisitors: 1_000_000,
    description: 'Higher fixed capacity for established agencies and larger teams.',
    marketingFeatures: [
      'Up to 10 Team Members',
      '50 Property Listings',
      '2,000 Active CRM Leads',
      'Custom Domain',
      'Advanced Analytics',
      'WhatsApp Integration',
      'Lead Automations',
      'Premium Templates',
      'Advanced Accounting',
    ],
    features: {
      customDomain: true,
      advancedAnalytics: true,
      whatsappIntegration: true,
      leadAutomation: true,
      smsAutomation: true,
      premiumTemplates: true,
      advancedAccounting: true,
    },
    isPopular: false,
  },
} as const satisfies Record<string, CurrentPlanCatalogEntry>

export const CURRENT_PLAN_CATALOG_ROWS: ReadonlyArray<CurrentPlanCatalogEntry> = Object.values(CURRENT_PLAN_CATALOG)

/** Map the business catalog to the currently persisted entitlement field names. */
export const catalogEntryToPlanWrite = (entry: CurrentPlanCatalogEntry): Record<string, unknown> => ({
  planId: entry.planId,
  name: entry.name,
  tierRank: entry.tierRank,
  priceMonthly: entry.priceMonthly,
  priceYearly: entry.priceYearly,
  currency: 'BDT',
  description: entry.description,
  features: [...entry.marketingFeatures],
  maxAgents: entry.teamMembers,
  maxProperties: entry.maxProperties,
  baseLeadCapacity: entry.baseLeadCapacity,
  maxAddonLeadCapacity: entry.maxAddonLeadCapacity,
  maxStorageMb: entry.storageMb,
  maxMonthlyVisitors: entry.monthlyVisitors,
  hasCustomDomain: entry.features.customDomain,
  hasAdvancedAnalytics: entry.features.advancedAnalytics,
  hasWhatsAppIntegration: entry.features.whatsappIntegration,
  hasLeadAutomations: entry.features.leadAutomation,
  hasSmsAutomation: entry.features.smsAutomation,
  hasPremiumTemplates: entry.features.premiumTemplates,
  hasAdvancedAccounting: entry.features.advancedAccounting,
  isPopular: entry.isPopular,
})
