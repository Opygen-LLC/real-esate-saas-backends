import mongoose, { Model, Schema } from 'mongoose'
import type { ILeadTopupPricing } from './leadTopupPricing.interface'

const leadTopupPricingSchema = new Schema<ILeadTopupPricing>({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  pricingMode: { type: String, enum: ['rate', 'package'], required: true, index: true },
  leadsPerUnit: { type: Number, min: 1, default: null },
  pricePerUnit: { type: Number, min: 0.01, default: null },
  packageLeads: { type: Number, min: 1, default: null },
  packagePrice: { type: Number, min: 0.01, default: null },
  currency: { type: String, enum: ['BDT'], default: 'BDT' },
  displayOrder: { type: Number, min: 0, default: 0, index: true },
  isActive: { type: Boolean, default: true, index: true },
  archivedAt: { type: Date, default: null },
  archivedBy: { type: String, default: null },
  createdBy: { type: String, required: true },
  updatedBy: { type: String, default: null },
}, { timestamps: true })

leadTopupPricingSchema.index({ isActive: 1, displayOrder: 1, createdAt: 1 })
leadTopupPricingSchema.index({ pricingMode: 1, isActive: 1, displayOrder: 1 })

leadTopupPricingSchema.pre('validate', function validateModeShape(next) {
  if (this.pricingMode === 'rate') {
    if (!Number.isFinite(Number(this.leadsPerUnit)) || Number(this.leadsPerUnit) < 1 || !Number.isFinite(Number(this.pricePerUnit)) || Number(this.pricePerUnit) <= 0) {
      return next(new Error('Rate pricing requires leadsPerUnit and pricePerUnit'))
    }
    this.packageLeads = null
    this.packagePrice = null
  } else {
    if (!Number.isFinite(Number(this.packageLeads)) || Number(this.packageLeads) < 1 || !Number.isFinite(Number(this.packagePrice)) || Number(this.packagePrice) <= 0) {
      return next(new Error('Package pricing requires packageLeads and packagePrice'))
    }
    this.leadsPerUnit = null
    this.pricePerUnit = null
  }
  next()
})

export const LeadTopupPricing: Model<ILeadTopupPricing> = mongoose.models.LeadTopupPricing
  || mongoose.model<ILeadTopupPricing>('LeadTopupPricing', leadTopupPricingSchema)
