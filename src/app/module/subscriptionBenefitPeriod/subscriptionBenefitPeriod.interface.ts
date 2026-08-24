import type { LeadAllowanceModel, SubscriptionPlanId } from '../subscriptionPlan/subscriptionPlan.interface'

export type BenefitPaymentSource = 'manual_payment' | 'bkash' | 'manual_admin'
export type BenefitBillingCycle = 'monthly' | 'yearly' | 'one-time'

export interface ISubscriptionBenefitPeriod {
  organizationId: string
  paymentSource: BenefitPaymentSource
  paymentNumber: string
  planId: SubscriptionPlanId
  planVersion: number
  leadAllowanceModel: LeadAllowanceModel
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
  voidedAt?: Date | null
  voidedBy?: string | null
  voidReason?: string | null
  createdAt?: Date
  updatedAt?: Date
}
