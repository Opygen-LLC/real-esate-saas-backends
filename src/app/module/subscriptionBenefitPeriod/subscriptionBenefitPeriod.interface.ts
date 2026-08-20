import type { SubscriptionPlanId } from '../subscriptionPlan/subscriptionPlan.interface'

export type BenefitPaymentSource = 'manual_payment' | 'bkash'
export type BenefitBillingCycle = 'monthly' | 'yearly' | 'one-time'

export interface ISubscriptionBenefitPeriod {
  organizationId: string
  paymentSource: BenefitPaymentSource
  paymentNumber: string
  planId: SubscriptionPlanId
  planVersion: number
  billingCycle: BenefitBillingCycle
  periodStart: Date
  periodEnd: Date
  renewalStreak: number
  baseLeadAllowance: number
  bonusLeadAllowance: number
  totalLeadAllowance: number
  usedLeadAllowance: number
  renewalBonusEnabled: boolean
  renewalLeadBonus: number
  maxRenewalLeadBonus: number
  continuityGraceDays: number
  createdAt?: Date
  updatedAt?: Date
}
