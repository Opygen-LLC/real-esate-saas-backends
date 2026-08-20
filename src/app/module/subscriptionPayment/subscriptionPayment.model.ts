import mongoose, { Model, Schema } from 'mongoose'
import { ISubscriptionPayment } from './subscriptionPayment.interface'

const subscriptionPaymentSchema = new Schema<ISubscriptionPayment>(
  {
    paymentNumber: { type: String, required: true, unique: true, index: true, trim: true },
    receiptNumber: { type: String, required: true, unique: true, index: true, trim: true },
    organizationId: { type: String, required: true, index: true },
    changeRequestId: { type: Schema.Types.ObjectId, ref: 'SubscriptionChangeRequest', default: null, index: true },
    planId: { type: String, enum: ['starter', 'professional', 'agency', 'enterprise'], required: true, index: true },
    planVersion: { type: Number, required: true, min: 1 },
    billingCycle: { type: String, enum: ['monthly', 'yearly', 'one-time'], required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['BDT'], default: 'BDT', required: true },
    method: { type: String, enum: ['cash', 'bank', 'bkash', 'nagad', 'other'], required: true },
    reference: { type: String, trim: true, maxlength: 200, default: '' },
    paidAt: { type: Date, default: null },
    status: { type: String, enum: ['pending', 'confirmed', 'rejected', 'cancelled'], default: 'pending', index: true },
    notes: { type: String, maxlength: 2000, default: '' },
    proofAssetId: { type: Schema.Types.ObjectId, ref: 'WebsiteAsset', default: null },
    recordedBy: { type: String, default: '' },
    confirmedBy: { type: String, default: '' },
    confirmedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: '' },
    rejectedAt: { type: Date, default: null },
    rejectedReason: { type: String, maxlength: 1000, default: '' },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    source: { type: String, enum: ['manual_admin', 'legacy_migration'], default: 'manual_admin' },
    // Keep these delivery-coordination fields internal. Historical rows do not become eligible automatically.
    confirmationNoticeEligible: { type: Boolean, default: false, select: false },
    customerAcknowledgedBy: { type: [String], default: [], select: false },
  },
  { timestamps: true, toJSON: { virtuals: true } },
)

subscriptionPaymentSchema.index({ organizationId: 1, createdAt: -1 }, { name: 'tenant_created' })
subscriptionPaymentSchema.index({ organizationId: 1, status: 1, createdAt: -1 }, { name: 'tenant_status_created' })
subscriptionPaymentSchema.index({ status: 1, createdAt: -1 }, { name: 'status_created' })
subscriptionPaymentSchema.index(
  { organizationId: 1, status: 1, confirmationNoticeEligible: 1, confirmedAt: -1, _id: -1 },
  { name: 'tenant_confirmation_delivery' },
)
subscriptionPaymentSchema.index(
  { changeRequestId: 1, status: 1 },
  { name: 'one_pending_payment_per_request', unique: true, partialFilterExpression: { changeRequestId: { $type: 'objectId' }, status: 'pending' } },
)
subscriptionPaymentSchema.index(
  { organizationId: 1, method: 1, reference: 1 },
  { name: 'tenant_method_reference', unique: true, partialFilterExpression: { reference: { $type: 'string', $gt: '' } } },
)

export const SubscriptionPayment: Model<ISubscriptionPayment> =
  mongoose.models.SubscriptionPayment || mongoose.model<ISubscriptionPayment>('SubscriptionPayment', subscriptionPaymentSchema)
