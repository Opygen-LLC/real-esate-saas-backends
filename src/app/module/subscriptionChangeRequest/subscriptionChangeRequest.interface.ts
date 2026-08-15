export type SubscriptionChangeRequestStatus =
  | 'pending_payment'
  | 'payment_submitted'
  | 'approved'
  | 'rejected'
  | 'cancelled'

export interface ISubscriptionChangeRequest {
  requestNumber: string
  organizationId: string
  currentPlan: 'trial' | 'starter' | 'professional' | 'agency' | 'enterprise'
  currentPlanVersion: number
  requestedPlan: 'starter' | 'professional' | 'agency' | 'enterprise'
  requestedPlanVersion: number
  billingCycle: 'monthly' | 'yearly'
  amount: number
  currency: 'BDT'
  status: SubscriptionChangeRequestStatus
  paymentId?: string
  requestedBy: string
  reviewedBy?: string
  reviewedAt?: Date | null
  rejectionReason?: string
  createdAt?: Date
  updatedAt?: Date
}
