export const PAID_PLAN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const PAID_PLAN_ID_MIN_LENGTH = 3
export const PAID_PLAN_ID_MAX_LENGTH = 50

const LEGACY_PLAN_ORDER: Record<string, number> = {
  starter: 10,
  professional: 20,
  agency: 30,
  enterprise: 40,
}

export const normalizePaidPlanId = (value: unknown): string => String(value || '').trim().toLowerCase()

export const isValidPaidPlanId = (value: unknown): boolean => {
  const planId = normalizePaidPlanId(value)
  return planId !== 'trial'
    && planId.length >= PAID_PLAN_ID_MIN_LENGTH
    && planId.length <= PAID_PLAN_ID_MAX_LENGTH
    && PAID_PLAN_ID_PATTERN.test(planId)
}

export const legacyPlanOrder = (planId: unknown): number | null => {
  const value = LEGACY_PLAN_ORDER[normalizePaidPlanId(planId)]
  return Number.isInteger(value) ? value : null
}

const nonNegativeIntegerOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

export const resolvePlanOrdering = <T extends Record<string, any>>(plan: T): T & { displayOrder: number; upgradeRank: number } => {
  const legacy = legacyPlanOrder(plan?.planId)
  const displayOrder = nonNegativeIntegerOrNull(plan?.displayOrder) ?? legacy ?? 1000
  const upgradeRank = nonNegativeIntegerOrNull(plan?.upgradeRank) ?? legacy ?? displayOrder
  return { ...plan, displayOrder, upgradeRank }
}
