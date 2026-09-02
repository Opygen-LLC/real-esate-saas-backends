import { Schema, model } from 'mongoose'
import type { IFinanceBillingProfile } from './financeBillingProfile.interface'

const financeBillingProfileSchema = new Schema<IFinanceBillingProfile>({
  organizationId: { type: String, required: true, unique: true, index: true },
  legalName: { type: String, required: true, trim: true, maxlength: 200 },
  email: { type: String, trim: true, lowercase: true, maxlength: 200, default: '' },
  phone: { type: String, trim: true, maxlength: 40, default: '' },
  address: { type: String, trim: true, maxlength: 1200, default: '' },
  taxId: { type: String, trim: true, maxlength: 120, default: '' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

export const FinanceBillingProfile = model<IFinanceBillingProfile>('FinanceBillingProfile', financeBillingProfileSchema)
