import type { Types } from 'mongoose'
import type { LeadTopupPricingMode } from '../leadTopupPricing/leadTopupPricing.interface'

export type LeadPurchaseRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface ILeadPurchaseRequest {
  requestNumber: string
  organizationId: string
  requestedBy: string
  currentPlan: string
  currentPlanVersion: number
  currentLeadCapacity: number
  currentLeadUsage: number
  requestedLeads: number
  benefitPeriodId: Types.ObjectId
  pricingRuleId: Types.ObjectId
  pricingMode: LeadTopupPricingMode
  pricingName: string
  leadsPerUnit?: number | null
  pricePerUnit?: number | null
  totalAmount: number
  currency: 'BDT'
  status: LeadPurchaseRequestStatus
  requestedAt: Date
  expiresAt: Date
  approvedAt?: Date | null
  approvedBy?: string | null
  rejectedAt?: Date | null
  rejectedBy?: string | null
  rejectionReason?: string | null
  cancelledAt?: Date | null
  cancelledBy?: string | null
  createdAt?: Date
  updatedAt?: Date
}
