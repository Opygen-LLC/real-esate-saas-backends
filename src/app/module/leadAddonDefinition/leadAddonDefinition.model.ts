import mongoose, { Model, Schema } from 'mongoose'
import type { ILeadAddonDefinition } from './leadAddonDefinition.interface'

const schema = new Schema<ILeadAddonDefinition>({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  slug: { type: String, required: true, trim: true, lowercase: true, minlength: 3, maxlength: 60, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, unique: true, index: true },
  leadCapacity: { type: Number, required: true, min: 1 },
  priceMonthly: { type: Number, required: true, min: 0.01 },
  currency: { type: String, enum: ['BDT'], default: 'BDT' },
  eligiblePlans: { type: [String], default: [], index: true },
  displayOrder: { type: Number, default: 0, min: 0, index: true },
  isActive: { type: Boolean, default: true, index: true },
  archivedAt: { type: Date, default: null, index: true },
  archivedBy: { type: String, default: null },
  createdBy: { type: String, default: '' },
  updatedBy: { type: String, default: '' },
}, { timestamps: true })

schema.index({ isActive: 1, archivedAt: 1, displayOrder: 1 })

export const LeadAddonDefinition: Model<ILeadAddonDefinition> = mongoose.models.LeadAddonDefinition
  || mongoose.model<ILeadAddonDefinition>('LeadAddonDefinition', schema)
