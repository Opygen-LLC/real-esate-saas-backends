export type PlanStatus = 'scheduled' | 'current' | 'grandfathered' | 'retired'

const asDate = (value: unknown): Date | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Phase 2 lifecycle read contract.
 *
 * status is canonical for new writes. Historical documents are resolved from the
 * legacy lifecycle fields so deployment does not require an all-at-once rewrite.
 */
export const resolvePlanStatus = (plan: Record<string, any>, at = new Date()): PlanStatus => {
  if (plan.status === 'scheduled' || plan.status === 'current' || plan.status === 'grandfathered' || plan.status === 'retired') {
    return plan.status
  }
  if (plan.isActive === false) return 'retired'
  const effectiveFrom = asDate(plan.effectiveFrom)
  if (effectiveFrom && effectiveFrom.getTime() > at.getTime()) return 'scheduled'
  if (plan.isCurrent === true) return 'current'
  return 'grandfathered'
}

/**
 * Compatibility mirrors for legacy readers. New code writes one lifecycle status;
 * old fields are derived until they can be removed in a later phase.
 */
export const mirrorPlanStatusWrite = <T extends Record<string, any>>(
  plan: T,
  status: PlanStatus,
  at = new Date(),
): T & {
  status: PlanStatus
  isActive: boolean
  isCurrent: boolean
  grandfatherExisting: boolean
  migrationAppliedAt: Date | null
} => {
  const effectiveFrom = asDate(plan.effectiveFrom) || at
  return {
    ...plan,
    status,
    isActive: status !== 'retired',
    isCurrent: status === 'current',
    grandfatherExisting: true,
    migrationAppliedAt: status === 'current' || status === 'grandfathered' ? (asDate(plan.migrationAppliedAt) || at) : null,
    effectiveFrom,
  }
}
