import mongoose, { Model, Schema } from 'mongoose'
import type { ILeadTopupGrant } from './leadTopupGrant.interface'

const leadTopupGrantSchema = new Schema<ILeadTopupGrant>({
  organizationId: { type: String, required: true, trim: true, index: true },
  benefitPeriodId: { type: Schema.Types.ObjectId, ref: 'SubscriptionBenefitPeriod', required: true, index: true },
  approvedRequestId: { type: Schema.Types.ObjectId, ref: 'LeadPurchaseRequest', required: true, unique: true, index: true },
  requestedLeads: { type: Number, required: true, min: 1 },
  grantedLeads: { type: Number, required: true, min: 1 },
  effectiveAt: { type: Date, required: true, index: true },
  expiresAt: { type: Date, required: true, index: true },
  approvedBy: { type: String, required: true },
  revokedAt: { type: Date, default: null, index: true },
  revokedBy: { type: String, default: null },
  revokeReason: { type: String, default: null, maxlength: 500 },
}, { timestamps: true })

leadTopupGrantSchema.index({ organizationId: 1, benefitPeriodId: 1, effectiveAt: 1, expiresAt: 1, revokedAt: 1 })
leadTopupGrantSchema.index({ organizationId: 1, expiresAt: -1, _id: -1 })

export const LeadTopupGrant: Model<ILeadTopupGrant> = mongoose.models.LeadTopupGrant
  || mongoose.model<ILeadTopupGrant>('LeadTopupGrant', leadTopupGrantSchema)
