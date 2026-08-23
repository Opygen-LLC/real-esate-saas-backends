export type LeadTopupPricingMode = 'rate' | 'package'

export interface ILeadTopupPricing {
  name: string
  pricingMode: LeadTopupPricingMode
  leadsPerUnit?: number | null
  pricePerUnit?: number | null
  packageLeads?: number | null
  packagePrice?: number | null
  currency: 'BDT'
  displayOrder: number
  isActive: boolean
  archivedAt?: Date | null
  archivedBy?: string | null
  createdBy: string
  updatedBy?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export interface LeadTopupQuote {
  pricingRuleId: string
  pricingMode: LeadTopupPricingMode
  pricingName: string
  requestedLeads: number
  leadsPerUnit: number | null
  pricePerUnit: number | null
  totalAmount: number
  currency: 'BDT'
}
