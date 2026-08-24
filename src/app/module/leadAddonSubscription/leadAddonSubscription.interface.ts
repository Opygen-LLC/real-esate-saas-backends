import type { Types } from 'mongoose'

export type LeadAddonSubscriptionStatus = 'pending_payment' | 'active' | 'cancel_at_period_end' | 'cancelled' | 'expired' | 'payment_failed' | 'rejected'

export interface ILeadAddonSubscription {
  organizationId: string
  definitionId: Types.ObjectId
  definitionName: string
  definitionSlug: string
  leadCapacity: number
  priceMonthly: number
  currency: 'BDT'
  planId: string
  planVersion: number
  billingCycle: 'monthly' | 'yearly'
  cyclePrice: number
  status: LeadAddonSubscriptionStatus
  quoteSnapshot?: Record<string, unknown> | null
  currentPeriodStart?: Date | null
  currentPeriodEnd?: Date | null
  cancelAtPeriodEnd: boolean
  requestedBy: string
  requestedAt: Date
  activatedBy?: string | null
  activatedAt?: Date | null
  paymentMethod?: string | null
  paymentReference?: string | null
  lastPaymentNumber?: string | null
  rejectedBy?: string | null
  rejectedAt?: Date | null
  rejectionReason?: string | null
  cancelledAt?: Date | null
  createdAt?: Date
  updatedAt?: Date
}
