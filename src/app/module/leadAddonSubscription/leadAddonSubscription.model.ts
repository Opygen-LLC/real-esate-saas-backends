import mongoose, { Model, Schema } from 'mongoose'
import type { ILeadAddonSubscription } from './leadAddonSubscription.interface'

const schema = new Schema<ILeadAddonSubscription>({
  organizationId: { type: String, required: true, trim: true, index: true },
  definitionId: { type: Schema.Types.ObjectId, ref: 'LeadAddonDefinition', required: true, index: true },
  definitionName: { type: String, required: true },
  definitionSlug: { type: String, required: true, index: true },
  leadCapacity: { type: Number, required: true, min: 1 },
  priceMonthly: { type: Number, required: true, min: 0.01 },
  currency: { type: String, enum: ['BDT'], default: 'BDT' },
  planId: { type: String, required: true, index: true },
  planVersion: { type: Number, required: true, min: 1 },
  billingCycle: { type: String, enum: ['monthly', 'yearly'], required: true },
  cyclePrice: { type: Number, required: true, min: 0.01 },
  status: { type: String, enum: ['pending_payment', 'active', 'cancel_at_period_end', 'cancelled', 'expired', 'payment_failed', 'rejected'], default: 'pending_payment', index: true },
  quoteSnapshot: { type: Schema.Types.Mixed, default: null },
  currentPeriodStart: { type: Date, default: null, index: true },
  currentPeriodEnd: { type: Date, default: null, index: true },
  cancelAtPeriodEnd: { type: Boolean, default: false },
  requestedBy: { type: String, required: true },
  requestedAt: { type: Date, default: Date.now },
  activatedBy: { type: String, default: null },
  activatedAt: { type: Date, default: null },
  paymentMethod: { type: String, default: null },
  paymentReference: { type: String, default: null },
  lastPaymentNumber: { type: String, default: null },
  rejectedBy: { type: String, default: null },
  rejectedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: null, maxlength: 500 },
  cancelledAt: { type: Date, default: null },
}, { timestamps: true })

schema.index({ organizationId: 1, status: 1, currentPeriodEnd: 1 })
schema.index({ organizationId: 1, definitionId: 1, createdAt: -1 })
schema.index({ organizationId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'pending_payment' } })
export const LeadAddonSubscription: Model<ILeadAddonSubscription> = mongoose.models.LeadAddonSubscription
  || mongoose.model<ILeadAddonSubscription>('LeadAddonSubscription', schema)
