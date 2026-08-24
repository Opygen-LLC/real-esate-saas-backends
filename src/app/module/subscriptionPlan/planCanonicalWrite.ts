import type { EntitlementConfig } from '../entitlement/entitlement.types'
import { normalizeEntitlementWrite } from '../entitlement/featureCatalog'
import { applyCanonicalAddonCapacityWrite } from './planAddonCapacity'
import { resolveBaseLeadCapacity } from './planLeadCapacity'
import { applyFixedLeadCapacityPolicyWrite, DEPRECATED_RENEWAL_GROWTH_FIELDS } from './planLeadPolicy'
import { mirrorTierRankWrite } from './planIdentity'

export const PHASE5_FORBIDDEN_NEW_PLAN_FIELDS = [
  'maxLeads',
  ...DEPRECATED_RENEWAL_GROWTH_FIELDS,
  'maxRecurringLeadAddon',
] as const

/**
 * Canonical Phase 5 plan write.
 *
 * Existing immutable versions may contain legacy aliases. New versions never do.
 * Other entitlement mirrors remain temporarily because the wider entitlement
 * engine still consumes them; lead capacity itself has exactly one persisted
 * plan source: baseLeadCapacity.
 */
export const applyCanonicalPlanWrite = <T extends Record<string, any>>(
  source: T,
  explicitEntitlements?: unknown,
): T & { baseLeadCapacity: number; maxAddonLeadCapacity: number | null; entitlements: EntitlementConfig } => {
  const normalizedEntitlements = normalizeEntitlementWrite(source, explicitEntitlements)
  const ranked = mirrorTierRankWrite(normalizedEntitlements)
  const baseLeadCapacity = resolveBaseLeadCapacity(ranked)
  const entitlementSource = ranked.entitlements instanceof Map
    ? Object.fromEntries(ranked.entitlements.entries())
    : (ranked.entitlements || {})
  const withCanonicalLead = {
    ...ranked,
    baseLeadCapacity,
    entitlements: {
      ...(entitlementSource as EntitlementConfig),
      leads: { enabled: baseLeadCapacity > 0, limit: baseLeadCapacity },
    },
  }
  const fixed = applyFixedLeadCapacityPolicyWrite(withCanonicalLead)
  const next = applyCanonicalAddonCapacityWrite(fixed) as Record<string, any>

  // normalizeEntitlementWrite mirrors entitlements back to maxLeads. Phase 5
  // deliberately removes that plan-level mirror after the canonical map is built.
  delete next.maxLeads
  for (const field of DEPRECATED_RENEWAL_GROWTH_FIELDS) delete next[field]
  delete next.maxRecurringLeadAddon

  return next as T & { baseLeadCapacity: number; maxAddonLeadCapacity: number | null; entitlements: EntitlementConfig }
}
