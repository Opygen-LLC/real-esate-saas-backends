import type { EntitlementConfig } from '../entitlement/entitlement.types'
import type { PlanStatus } from './planLifecycle'

export type SubscriptionPlanId = string
export type LeadAllowanceModel = 'paid_period_credits' | 'active_capacity'

export interface ISubscriptionPlan {
  planId: SubscriptionPlanId
  version: number
  name: string
  tierRank: number
  // Legacy mirrors kept during Phase 1 for backward compatibility.
  displayOrder: number
  upgradeRank: number
  priceMonthly: number
  priceYearly: number
  currency: 'BDT'
  description: string
  features: string[]
  entitlements?: EntitlementConfig
  maxAgents: number
  maxProperties: number
  baseLeadCapacity: number
  // Legacy mirrors kept during Phase 1 for backward compatibility.
  maxLeads: number
  leadAllowanceModel: LeadAllowanceModel
  baseMonthlyLeadAllowance: number
  renewalLeadBonus: number
  renewalBonusEnabled: boolean
  maxRenewalLeadBonus: number
  continuityGraceDays: number
  maxRecurringLeadAddon: number
  hasCustomDomain: boolean
  hasAdvancedAnalytics: boolean
  hasWhatsAppIntegration: boolean
  hasLeadAutomations: boolean
  hasSmsAutomation: boolean
  hasPremiumTemplates: boolean
  maxStorageMb: number
  maxMonthlyVisitors: number
  isPopular?: boolean
  status?: PlanStatus
  // Legacy lifecycle mirrors kept during Phase 2 for backward compatibility.
  isActive: boolean
  isCurrent: boolean
  effectiveFrom: Date
  effectiveTo?: Date | null
  grandfatherExisting: boolean
  migrationAppliedAt?: Date | null
  changeReason?: string
  createdBy?: string
  createdAt?: Date
  updatedAt?: Date
}
