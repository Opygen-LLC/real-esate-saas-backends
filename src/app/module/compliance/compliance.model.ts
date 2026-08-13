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

const consentSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  purpose: { type: String, enum: ['service_terms', 'privacy_policy', 'marketing'], required: true },
  policyVersion: { type: String, required: true },
  granted: { type: Boolean, required: true },
  capturedAt: { type: Date, default: Date.now },
  ip: { type: String, default: '' }, requestId: { type: String, default: '' },
}, { versionKey: false })

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
export const ConsentRecord = model('ConsentRecord', consentSchema)
export const DataSubjectRequest = model('DataSubjectRequest', dataRequestSchema)
