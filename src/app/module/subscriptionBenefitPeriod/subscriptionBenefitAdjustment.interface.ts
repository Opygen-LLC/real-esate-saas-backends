import type { SubscriptionPlanId } from '../subscriptionPlan/subscriptionPlan.interface'

export interface ISubscriptionBenefitStreakAdjustment {
  organizationId: string
  benefitPeriodId: string
  paymentNumber: string
  planId: SubscriptionPlanId
  planVersion: number
  previousEffectiveRenewalStreak: number
  adjustedRenewalStreak: number
  reason: string
  actorId: string
  requestId?: string
  ip?: string
  createdAt?: Date
  updatedAt?: Date
}
