export interface ISubscriptionPlan {
  planId: 'starter' | 'professional' | 'agency' | 'enterprise'
  name: string
  priceMonthly: number
  priceYearly: number
  currency: string
  description: string
  features: string[]
  maxAgents: number
  maxProperties: number
  maxLeads: number
  hasCustomDomain: boolean
  hasAdvancedAnalytics: boolean
  hasWhatsAppIntegration: boolean
  hasLeadAutomations: boolean
  isPopular?: boolean
  isActive: boolean
}
