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
  'advancedAccounting',
  'customerFinance',
  'materialsInventory',
  'supplierManagement',
] as const

export type EntitlementFeatureId = (typeof ENTITLEMENT_FEATURE_IDS)[number]
export type EntitlementFeatureKind = 'integer_limit' | 'storage_limit' | 'usage_limit' | 'boolean'

export const ENTITLEMENT_CAPABILITIES = {
  ADVANCED_ACCOUNTING: 'advancedAccounting',
  CUSTOMER_FINANCE: 'customerFinance',
  MATERIALS_INVENTORY: 'materialsInventory',
  SUPPLIER_MANAGEMENT: 'supplierManagement',
} as const

export const ENTITLEMENT_PUBLIC_KEYS = {
  ADVANCED_ACCOUNTING: 'advanced_accounting',
  CUSTOMER_FINANCE: 'customer_finance',
  MATERIALS_INVENTORY: 'materials_inventory',
  SUPPLIER_MANAGEMENT: 'supplier_management',
} as const

export type EntitlementCapability = keyof typeof ENTITLEMENT_CAPABILITIES

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
  hasAdvancedAccounting: boolean
  hasCustomerFinance: boolean
  hasMaterialsInventory: boolean
  hasSupplierManagement: boolean
}
