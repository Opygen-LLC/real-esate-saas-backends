import type { EntitlementConfig } from '../entitlement/entitlement.types'

const nonNegativeIntegerOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

const entitlementLeadLimit = (entitlements: unknown): number | null => {
  if (!entitlements || typeof entitlements !== 'object') return null
  const source = entitlements instanceof Map ? Object.fromEntries(entitlements.entries()) : entitlements as Record<string, any>
  const leads = source.leads instanceof Map ? Object.fromEntries(source.leads.entries()) : source.leads
  if (!leads || typeof leads !== 'object') return null
  return nonNegativeIntegerOrNull((leads as Record<string, unknown>).limit)
}

/**
 * Read compatibility: expose the new canonical field without rewriting immutable
 * historical versions. For old plans, the renewal base is the closest equivalent
 * to "base lead capacity"; maxLeads remains untouched on reads.
 */
export const resolveBaseLeadCapacity = (plan: Record<string, any>): number => (
  nonNegativeIntegerOrNull(plan.baseLeadCapacity)
  ?? nonNegativeIntegerOrNull(plan.baseMonthlyLeadAllowance)
  ?? entitlementLeadLimit(plan.entitlements)
  ?? nonNegativeIntegerOrNull(plan.maxLeads)
  ?? 0
)

/**
 * Write compatibility: one canonical number controls the remaining Phase 1 legacy
 * lead-capacity mirrors. Phase 3 deliberately stops persisting the deprecated
 * baseMonthlyLeadAllowance renewal-policy field on new plan versions.
 */
export const mirrorBaseLeadCapacityWrite = <T extends Record<string, any>>(
  plan: T,
): T & { baseLeadCapacity: number; maxLeads: number; entitlements: EntitlementConfig } => {
  const baseLeadCapacity = resolveBaseLeadCapacity(plan)
  const source = plan.entitlements instanceof Map
    ? Object.fromEntries(plan.entitlements.entries())
    : (plan.entitlements && typeof plan.entitlements === 'object' ? plan.entitlements : {})
  const entitlements: EntitlementConfig = {
    ...(source as EntitlementConfig),
    leads: { enabled: baseLeadCapacity > 0, limit: baseLeadCapacity },
  }

  return {
    ...plan,
    baseLeadCapacity,
    maxLeads: baseLeadCapacity,
    entitlements,
  }
}
