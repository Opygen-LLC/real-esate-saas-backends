import mongoose from 'mongoose'

export type ManualPaymentMethod = 'cash' | 'bank' | 'bkash' | 'nagad' | 'other'
export type SubscriptionPaymentStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled'
export type SubscriptionBillingCycle = 'monthly' | 'yearly' | 'one-time'

export interface ISubscriptionPayment {
  paymentNumber: string
  receiptNumber: string
  organizationId: string
  changeRequestId?: mongoose.Types.ObjectId | string | null
  planId: 'starter' | 'professional' | 'agency' | 'enterprise'
  planVersion: number
  billingCycle: SubscriptionBillingCycle
  amount: number
  currency: 'BDT'
  method: ManualPaymentMethod
  reference?: string
  paidAt?: Date | null
  status: SubscriptionPaymentStatus
  notes?: string
  proofAssetId?: mongoose.Types.ObjectId | string | null
  recordedBy?: string
  confirmedBy?: string
  confirmedAt?: Date | null
  rejectedBy?: string
  rejectedAt?: Date | null
  rejectedReason?: string
  periodStart?: Date | null
  periodEnd?: Date | null
  source?: 'manual_admin' | 'legacy_migration'
  createdAt?: Date
  updatedAt?: Date
}
