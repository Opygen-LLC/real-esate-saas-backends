export const ENTITLEMENT_FEATURE_IDS = [
  'leads',
  'properties',
  'teamMembers',
  'storage',
  'monthlyVisitors',
  'customDomain',
  'advancedAnalytics',
  'whatsappIntegration',
  'smsAutomation',
  'leadAutomations',
  'premiumTemplates',
] as const

export type EntitlementFeatureId = (typeof ENTITLEMENT_FEATURE_IDS)[number]
export type EntitlementFeatureKind = 'integer_limit' | 'storage_limit' | 'usage_limit' | 'boolean'

export interface EntitlementValue {
  enabled: boolean
  limit?: number
}

export type EntitlementConfig = Partial<Record<EntitlementFeatureId, EntitlementValue>>

export interface LegacyEntitlementFields {
  maxAgents: number
  maxProperties: number
  maxLeads: number
  maxStorageMb: number
  maxMonthlyVisitors: number
  hasCustomDomain: boolean
  hasAdvancedAnalytics: boolean
  hasWhatsAppIntegration: boolean
  hasSmsAutomation: boolean
  hasLeadAutomations: boolean
  hasPremiumTemplates: boolean
}
