import { Schema, model } from 'mongoose'

const fraudReportSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
  reporterName: { type: String, default: '' }, reporterEmail: { type: String, default: '' },
  reporterPhone: { type: String, default: '' },
  category: { type: String, enum: ['fake_listing', 'wrong_information', 'duplicate', 'fraud_attempt', 'other'], required: true },
  details: { type: String, required: true },
  status: { type: String, enum: ['open', 'investigating', 'resolved', 'dismissed'], default: 'open', index: true },
  resolutionReason: { type: String, default: '' }, resolvedBy: { type: String, default: '' }, resolvedAt: { type: Date, default: null },
  requestId: { type: String, default: '' }, ip: { type: String, default: '' },
}, { timestamps: true })
fraudReportSchema.index({ organizationId: 1, status: 1, createdAt: -1 })
export const FraudReport = model('FraudReport', fraudReportSchema)
