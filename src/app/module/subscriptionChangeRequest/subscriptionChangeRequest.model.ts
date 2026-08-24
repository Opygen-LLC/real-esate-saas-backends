import mongoose, { Model, Schema } from 'mongoose'
import { ISubscriptionChangeRequest } from './subscriptionChangeRequest.interface'
import { PAID_PLAN_ID_PATTERN } from '../subscriptionPlan/planIdentity'

const subscriptionChangeRequestSchema = new Schema<ISubscriptionChangeRequest>(
  {
    requestNumber: { type: String, required: true, unique: true, index: true, trim: true },
    organizationId: { type: String, required: true, index: true },
    currentPlan: { type: String, required: true, trim: true, lowercase: true, validate: { validator: (value: string) => value === 'trial' || PAID_PLAN_ID_PATTERN.test(value), message: 'Invalid current plan ID' } },
    currentPlanVersion: { type: Number, required: true, min: 1 },
    requestedPlan: { type: String, required: true, trim: true, lowercase: true, minlength: 3, maxlength: 50, match: PAID_PLAN_ID_PATTERN },
    requestedPlanName: { type: String, trim: true, maxlength: 120, default: '' },
    requestedPlanVersion: { type: Number, required: true, min: 1 },
    billingCycle: { type: String, enum: ['monthly', 'yearly'], required: true },
    amount: { type: Number, required: true, min: 0 },
    quoteSnapshot: { type: Schema.Types.Mixed, default: null },
    currency: { type: String, enum: ['BDT'], default: 'BDT', required: true },
    changeType: { type: String, enum: ['upgrade', 'downgrade', 'version_change'], index: true },
    status: {
      type: String,
      enum: ['pending_payment', 'payment_submitted', 'scheduled', 'approved', 'applied', 'rejected', 'cancelled'],
      default: 'pending_payment',
      index: true,
    },
    paymentId: { type: String, default: '', index: true },
    requestedBy: { type: String, required: true },
    reviewedBy: { type: String, default: '' },
    reviewedAt: { type: Date, default: null },
    scheduledEffectiveAt: { type: Date, default: null, index: true },
    appliedAt: { type: Date, default: null },
    rejectionReason: { type: String, maxlength: 1000, default: '' },
  },
  { timestamps: true, toJSON: { virtuals: true } },
)

subscriptionChangeRequestSchema.index({ organizationId: 1, createdAt: -1 }, { name: 'tenant_created' })
subscriptionChangeRequestSchema.index({ organizationId: 1, status: 1, createdAt: -1 }, { name: 'tenant_status_created' })
subscriptionChangeRequestSchema.index({ status: 1, createdAt: -1 }, { name: 'status_created' })
subscriptionChangeRequestSchema.index(
  { organizationId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending_payment', 'payment_submitted'] } },
    name: 'one_open_subscription_change_per_tenant',
  },
)

export const SubscriptionChangeRequest: Model<ISubscriptionChangeRequest> =
  mongoose.models.SubscriptionChangeRequest ||
  mongoose.model<ISubscriptionChangeRequest>('SubscriptionChangeRequest', subscriptionChangeRequestSchema)
