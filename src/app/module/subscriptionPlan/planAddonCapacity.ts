export type MaxAddonLeadCapacity = number | null

const nonNegativeIntegerOrNull = (value: unknown): number | null => {
  if (value === null) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.trunc(parsed))
}

/**
 * Phase 4 canonical recurring add-on ceiling.
 * - number: maximum additional recurring lead capacity
 * - 0: recurring add-ons are disabled for this plan version
 * - null: unlimited recurring add-on capacity
 *
 * Historical immutable plan versions may only have maxRecurringLeadAddon.
 */
export const resolveMaxAddonLeadCapacity = (plan: Record<string, any>): MaxAddonLeadCapacity => {
  if (plan?.maxAddonLeadCapacity !== undefined) {
    return nonNegativeIntegerOrNull(plan.maxAddonLeadCapacity)
  }
  if (plan?.maxRecurringLeadAddon !== undefined) {
    return nonNegativeIntegerOrNull(plan.maxRecurringLeadAddon)
  }
  return 0
}

/**
 * New plan writes persist only maxAddonLeadCapacity. The legacy field remains
 * readable on historical plan documents, but is intentionally not copied into
 * newly-created immutable versions.
 */
export const applyCanonicalAddonCapacityWrite = <T extends Record<string, any>>(plan: T): T & { maxAddonLeadCapacity: MaxAddonLeadCapacity } => {
  const next = { ...plan } as Record<string, any>
  next.maxAddonLeadCapacity = resolveMaxAddonLeadCapacity(plan)
  delete next.maxRecurringLeadAddon
  return next as T & { maxAddonLeadCapacity: MaxAddonLeadCapacity }
}

export const addonCapacityWithinLimit = (
  currentCapacity: number,
  requestedCapacity: number,
  maximum: MaxAddonLeadCapacity,
): boolean => {
  const current = Math.max(0, Math.trunc(Number(currentCapacity || 0)))
  const requested = Math.max(0, Math.trunc(Number(requestedCapacity || 0)))
  if (maximum === null) return true
  return current + requested <= maximum
}

export const addonCapacityLabel = (maximum: MaxAddonLeadCapacity): string => (
  maximum === null ? 'Unlimited' : maximum.toLocaleString()
)
