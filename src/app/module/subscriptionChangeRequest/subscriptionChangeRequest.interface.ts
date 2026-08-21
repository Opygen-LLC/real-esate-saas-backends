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
  currentPlan: 'trial' | 'starter' | 'professional' | 'agency' | 'enterprise'
  currentPlanVersion: number
  requestedPlan: 'starter' | 'professional' | 'agency' | 'enterprise'
  requestedPlanName?: string
  requestedPlanVersion: number
  billingCycle: 'monthly' | 'yearly'
  amount: number
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
