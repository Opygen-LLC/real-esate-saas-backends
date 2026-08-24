import type { SubscriptionQuoteSnapshot } from '../subscription/subscriptionQuote.service'

export type SubscriptionChangeRequestStatus =
  | 'pending_payment'
  | 'payment_submitted'
  | 'scheduled'
  | 'approved'
  | 'applied'
  | 'rejected'
  | 'cancelled'

export interface ISubscriptionChangeRequest {
  requestNumber: string
  organizationId: string
  currentPlan: string
  currentPlanVersion: number
  requestedPlan: string
  requestedPlanName?: string
  requestedPlanVersion: number
  billingCycle: 'monthly' | 'yearly'
  amount: number
  quoteSnapshot?: SubscriptionQuoteSnapshot | null
  currency: 'BDT'
  changeType?: 'upgrade' | 'downgrade' | 'version_change'
  status: SubscriptionChangeRequestStatus
  paymentId?: string
  requestedBy: string
  reviewedBy?: string
  reviewedAt?: Date | null
  scheduledEffectiveAt?: Date | null
  appliedAt?: Date | null
  rejectionReason?: string
  createdAt?: Date
  updatedAt?: Date
}
