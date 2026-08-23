import mongoose, { Model, Schema } from 'mongoose'
import type { ILeadPurchaseRequest } from './leadPurchaseRequest.interface'

const leadPurchaseRequestSchema = new Schema<ILeadPurchaseRequest>({
  requestNumber: { type: String, required: true, unique: true, index: true },
  organizationId: { type: String, required: true, trim: true, index: true },
  requestedBy: { type: String, required: true, index: true },
  currentPlan: { type: String, required: true, trim: true },
  currentPlanVersion: { type: Number, required: true, min: 1 },
  currentLeadCapacity: { type: Number, required: true, min: 0 },
  currentLeadUsage: { type: Number, required: true, min: 0 },
  requestedLeads: { type: Number, required: true, min: 1 },
  benefitPeriodId: { type: Schema.Types.ObjectId, ref: 'SubscriptionBenefitPeriod', required: true, index: true },
  pricingRuleId: { type: Schema.Types.ObjectId, ref: 'LeadTopupPricing', required: true },
  pricingMode: { type: String, enum: ['rate', 'package'], required: true },
  pricingName: { type: String, required: true, trim: true },
  leadsPerUnit: { type: Number, min: 1, default: null },
  pricePerUnit: { type: Number, min: 0.01, default: null },
  totalAmount: { type: Number, required: true, min: 0.01 },
  currency: { type: String, enum: ['BDT'], default: 'BDT' },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
  requestedAt: { type: Date, required: true, default: Date.now, index: true },
  expiresAt: { type: Date, required: true, index: true },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: String, default: null },
  rejectedAt: { type: Date, default: null },
  rejectedBy: { type: String, default: null },
  rejectionReason: { type: String, default: null, maxlength: 500 },
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: String, default: null },
}, { timestamps: true })

leadPurchaseRequestSchema.index({ organizationId: 1, createdAt: -1, _id: -1 })
leadPurchaseRequestSchema.index({ status: 1, createdAt: -1, _id: -1 })
leadPurchaseRequestSchema.index(
  { organizationId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' }, name: 'one_pending_lead_purchase_per_tenant' },
)

export const LeadPurchaseRequest: Model<ILeadPurchaseRequest> = mongoose.models.LeadPurchaseRequest
  || mongoose.model<ILeadPurchaseRequest>('LeadPurchaseRequest', leadPurchaseRequestSchema)
