import {
  ENTITLEMENT_FEATURE_IDS,
  type EntitlementConfig,
  type EntitlementFeatureId,
  type EntitlementFeatureKind,
  type EntitlementValue,
  type LegacyEntitlementFields,
} from './entitlement.types'

type LimitLegacyField = 'maxAgents' | 'maxProperties' | 'maxLeads' | 'maxStorageMb' | 'maxMonthlyVisitors'
type BooleanLegacyField = 'hasCustomDomain' | 'hasAdvancedAnalytics' | 'hasWhatsAppIntegration' | 'hasSmsAutomation' | 'hasLeadAutomations' | 'hasPremiumTemplates'

export interface FeatureCatalogEntry {
  id: EntitlementFeatureId
  label: string
  kind: EntitlementFeatureKind
  legacyField: LimitLegacyField | BooleanLegacyField
  unit?: 'count' | 'MB' | 'visitors/month'
}

export const FEATURE_CATALOG: Record<EntitlementFeatureId, FeatureCatalogEntry> = {
  leads: { id: 'leads', label: 'Leads', kind: 'integer_limit', legacyField: 'maxLeads', unit: 'count' },
  properties: { id: 'properties', label: 'Properties', kind: 'integer_limit', legacyField: 'maxProperties', unit: 'count' },
  teamMembers: { id: 'teamMembers', label: 'Team members', kind: 'integer_limit', legacyField: 'maxAgents', unit: 'count' },
  storage: { id: 'storage', label: 'Storage', kind: 'storage_limit', legacyField: 'maxStorageMb', unit: 'MB' },
  monthlyVisitors: { id: 'monthlyVisitors', label: 'Monthly visitors', kind: 'usage_limit', legacyField: 'maxMonthlyVisitors', unit: 'visitors/month' },
  customDomain: { id: 'customDomain', label: 'Custom domain', kind: 'boolean', legacyField: 'hasCustomDomain' },
  advancedAnalytics: { id: 'advancedAnalytics', label: 'Advanced analytics', kind: 'boolean', legacyField: 'hasAdvancedAnalytics' },
  whatsappIntegration: { id: 'whatsappIntegration', label: 'WhatsApp integration', kind: 'boolean', legacyField: 'hasWhatsAppIntegration' },
  smsAutomation: { id: 'smsAutomation', label: 'SMS automation', kind: 'boolean', legacyField: 'hasSmsAutomation' },
  leadAutomations: { id: 'leadAutomations', label: 'Lead automation', kind: 'boolean', legacyField: 'hasLeadAutomations' },
  premiumTemplates: { id: 'premiumTemplates', label: 'Premium templates', kind: 'boolean', legacyField: 'hasPremiumTemplates' },
}

const asPlainEntitlements = (value: unknown): Record<string, unknown> => {
  if (value instanceof Map) return Object.fromEntries(value.entries())
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

const asEntitlementValue = (value: unknown): EntitlementValue | undefined => {
  const raw = value instanceof Map ? Object.fromEntries(value.entries()) : value
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const enabled = Boolean(record.enabled)
  const numericLimit = Number(record.limit)
  return Number.isFinite(numericLimit)
    ? { enabled, limit: Math.max(0, Math.trunc(numericLimit)) }
    : { enabled }
}

export const buildEntitlementsFromLegacy = (source: Partial<LegacyEntitlementFields> & Record<string, unknown>): EntitlementConfig => {
  const result: EntitlementConfig = {}
  for (const id of ENTITLEMENT_FEATURE_IDS) {
    const feature = FEATURE_CATALOG[id]
    if (feature.kind === 'boolean') {
      result[id] = { enabled: Boolean(source[feature.legacyField]) }
      continue
    }
    const limit = Math.max(0, Math.trunc(Number(source[feature.legacyField] ?? 0)))
    result[id] = { enabled: limit > 0, limit }
  }
  return result
}

export const mergeEntitlementConfig = (base: EntitlementConfig, override: unknown): EntitlementConfig => {
  const rawOverride = asPlainEntitlements(override)
  const result: EntitlementConfig = { ...base }
  for (const id of ENTITLEMENT_FEATURE_IDS) {
    const value = asEntitlementValue(rawOverride[id])
    if (!value) continue
    const feature = FEATURE_CATALOG[id]
    result[id] = feature.kind === 'boolean'
      ? { enabled: value.enabled }
      : { enabled: value.enabled, limit: Math.max(0, Number(value.limit || 0)) }
  }
  return result
}

export const legacyFieldsFromEntitlements = (entitlements: EntitlementConfig): LegacyEntitlementFields => {
  const result: Record<string, number | boolean> = {}
  for (const id of ENTITLEMENT_FEATURE_IDS) {
    const feature = FEATURE_CATALOG[id]
    const value = entitlements[id]
    if (feature.kind === 'boolean') {
      result[feature.legacyField] = Boolean(value?.enabled)
      continue
    }
    result[feature.legacyField] = value?.enabled === false ? 0 : Math.max(0, Math.trunc(Number(value?.limit || 0)))
  }
  return result as unknown as LegacyEntitlementFields
}

/**
 * Read path: persisted entitlements are authoritative when present; legacy fields
 * are the fallback for grandfathered plan/trial documents.
 */
export const resolveEntitlementSource = <T extends Record<string, any>>(source: T): T & LegacyEntitlementFields & { entitlements: EntitlementConfig } => {
  const legacy = buildEntitlementsFromLegacy(source)
  const entitlements = mergeEntitlementConfig(legacy, source.entitlements)
  return { ...source, ...legacyFieldsFromEntitlements(entitlements), entitlements }
}

/**
 * Write path: old clients still submit legacy fields, so a write without an
 * explicit entitlements object rebuilds the canonical map from the merged legacy
 * values. New clients may submit a partial entitlements object and it is merged
 * over those values, then mirrored back into legacy persistence fields.
 */
export const normalizeEntitlementWrite = <T extends Record<string, any>>(
  mergedSource: T,
  explicitEntitlements?: unknown,
): T & LegacyEntitlementFields & { entitlements: EntitlementConfig } => {
  const base = buildEntitlementsFromLegacy(mergedSource)
  const entitlements = explicitEntitlements === undefined
    ? base
    : mergeEntitlementConfig(base, explicitEntitlements)
  return { ...mergedSource, ...legacyFieldsFromEntitlements(entitlements), entitlements }
}
