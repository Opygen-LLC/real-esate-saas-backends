import type { LeadAllowanceModel } from './subscriptionPlan.interface'
import { resolveBaseLeadCapacity } from './planLeadCapacity'

export const FIXED_LEAD_POLICY_VERSION = 2 as const

export const DEPRECATED_RENEWAL_GROWTH_FIELDS = [
  'leadAllowanceModel',
  'baseMonthlyLeadAllowance',
  'renewalLeadBonus',
  'renewalBonusEnabled',
  'maxRenewalLeadBonus',
  'continuityGraceDays',
] as const

export type ResolvedPlanLeadPolicy = {
  leadPolicyVersion?: number
  baseLeadCapacity: number
  leadAllowanceModel: LeadAllowanceModel
  baseMonthlyLeadAllowance: number
  renewalLeadBonus: number
  renewalBonusEnabled: boolean
  maxRenewalLeadBonus: number
  continuityGraceDays: number
}

const integer = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

export const usesFixedLeadCapacityPolicy = (plan: Record<string, any>): boolean => (
  Number(plan?.leadPolicyVersion || 0) >= FIXED_LEAD_POLICY_VERSION
)

/**
 * Phase 3 write contract. New plan versions persist one canonical lead limit and
 * a system-owned policy version marker. Historical renewal fields are intentionally
 * omitted so immutable old versions remain the only source of loyalty-growth rules.
 */
export const stripDeprecatedRenewalGrowthFields = <T extends Record<string, any>>(plan: T): T => {
  const next = { ...plan } as Record<string, any>
  for (const field of DEPRECATED_RENEWAL_GROWTH_FIELDS) delete next[field]
  return next as T
}

export const applyFixedLeadCapacityPolicyWrite = <T extends Record<string, any>>(plan: T): T & { leadPolicyVersion: 2 } => ({
  ...stripDeprecatedRenewalGrowthFields(plan),
  leadPolicyVersion: FIXED_LEAD_POLICY_VERSION,
})

/**
 * Read compatibility. Fixed-policy plans expose zero-growth compatibility values to
 * older services/clients, while historical versions keep the exact renewal-growth
 * semantics stored on those immutable records.
 */
export const resolvePlanLeadPolicy = <T extends Record<string, any>>(plan: T): T & ResolvedPlanLeadPolicy => {
  const baseLeadCapacity = resolveBaseLeadCapacity(plan)

  if (usesFixedLeadCapacityPolicy(plan)) {
    return {
      ...plan,
      baseLeadCapacity,
      leadAllowanceModel: 'active_capacity',
      baseMonthlyLeadAllowance: baseLeadCapacity,
      renewalLeadBonus: 0,
      renewalBonusEnabled: false,
      maxRenewalLeadBonus: 0,
      continuityGraceDays: 0,
    }
  }

  // Historical compatibility only. Do not write these fallback values back to old
  // immutable plan versions. They preserve behavior for records created before the
  // loyalty fields were fully materialized.
  const starterFallback = String(plan.planId || '') === 'starter'
  const leadAllowanceModel: LeadAllowanceModel = plan.leadAllowanceModel === 'active_capacity'
    ? 'active_capacity'
    : 'paid_period_credits'
  const baseMonthlyLeadAllowance = integer(plan.baseMonthlyLeadAllowance ?? baseLeadCapacity)
  const renewalLeadBonus = integer(plan.renewalLeadBonus ?? (starterFallback ? 50 : 0))
  const renewalBonusEnabled = Boolean(plan.renewalBonusEnabled ?? (starterFallback && renewalLeadBonus > 0))
  const maxRenewalLeadBonus = integer(plan.maxRenewalLeadBonus ?? (starterFallback ? 500 : 0))
  const continuityGraceDays = Math.min(31, integer(plan.continuityGraceDays ?? (starterFallback ? 3 : 0)))

  return {
    ...plan,
    baseLeadCapacity,
    leadAllowanceModel,
    baseMonthlyLeadAllowance,
    renewalLeadBonus,
    renewalBonusEnabled,
    maxRenewalLeadBonus,
    continuityGraceDays,
  }
}

/**
 * Build the immutable benefit-ledger input from either a fixed Phase 3 plan or an
 * historical plan. Fixed plans carry only the canonical base capacity and policy
 * marker; historical plans carry their stored loyalty configuration unchanged.
 */
export const toBenefitPlanSnapshot = (plan: Record<string, any>) => {
  const resolved = resolvePlanLeadPolicy(plan)
  if (usesFixedLeadCapacityPolicy(resolved)) {
    return {
      planId: resolved.planId,
      version: Number(resolved.version || 1),
      leadPolicyVersion: FIXED_LEAD_POLICY_VERSION,
      baseLeadCapacity: resolved.baseLeadCapacity,
    }
  }
  return {
    planId: resolved.planId,
    version: Number(resolved.version || 1),
    baseLeadCapacity: resolved.baseLeadCapacity,
    leadAllowanceModel: resolved.leadAllowanceModel,
    baseMonthlyLeadAllowance: resolved.baseMonthlyLeadAllowance,
    renewalLeadBonus: resolved.renewalLeadBonus,
    renewalBonusEnabled: resolved.renewalBonusEnabled,
    maxRenewalLeadBonus: resolved.maxRenewalLeadBonus,
    continuityGraceDays: resolved.continuityGraceDays,
  }
}
