import { Schema, model } from 'mongoose'

const complianceProfileSchema = new Schema({
  organizationId: { type: String, required: true, unique: true, index: true },
  requiredDocuments: { type: [String], enum: ['nid', 'trade_license', 'tin', 'bin'], default: [] },
  nidEncrypted: { type: String, default: '', select: false },
  tradeLicenseEncrypted: { type: String, default: '', select: false },
  tinEncrypted: { type: String, default: '', select: false },
  binEncrypted: { type: String, default: '', select: false },
  verificationStatus: { type: String, enum: ['not_submitted', 'pending', 'in_review', 'verified', 'rejected', 'suspended'], default: 'not_submitted', index: true },
  submittedAt: { type: Date, default: null },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: String, default: '' },
  reviewReason: { type: String, default: '' },
}, { timestamps: true, toJSON: { virtuals: true } })


const dataRequestSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  requestedBy: { type: String, required: true },
  type: { type: String, enum: ['export', 'deletion'], required: true },
  status: { type: String, enum: ['requested', 'in_review', 'approved', 'completed', 'rejected', 'cancelled'], default: 'requested', index: true },
  requestReason: { type: String, default: '' },
  operatorReason: { type: String, default: '' },
  retentionUntil: { type: Date, default: null },
  processedBy: { type: String, default: '' }, processedAt: { type: Date, default: null },
}, { timestamps: true })

export const ComplianceProfile = model('ComplianceProfile', complianceProfileSchema)
export const DataSubjectRequest = model('DataSubjectRequest', dataRequestSchema)
