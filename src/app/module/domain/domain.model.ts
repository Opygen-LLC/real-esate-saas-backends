import { Schema, model } from 'mongoose'

export type DomainStatus = 'pending' | 'verified' | 'failed'
export type TlsStatus = 'not_started' | 'provisioning' | 'active' | 'failed'

const domainRecordSchema = new Schema({
  organizationId: { type: String, required: true, unique: true, index: true },
  domain: { type: String, required: true, unique: true, index: true },
  ownershipToken: { type: String, required: true },
  status: { type: String, enum: ['pending', 'verified', 'failed'], default: 'pending', index: true },
  tlsStatus: { type: String, enum: ['not_started', 'provisioning', 'active', 'failed'], default: 'not_started' },
  providerRequestId: { type: String, default: '' },
  requiredDns: { type: [Schema.Types.Mixed], default: [] },
  diagnostics: { type: [Schema.Types.Mixed], default: [] },
  lastCheckedAt: { type: Date, default: null },
  verifiedAt: { type: Date, default: null },
  nextCheckAt: { type: Date, default: Date.now, index: true },
  failureCount: { type: Number, default: 0 },
}, { timestamps: true })

domainRecordSchema.index({ status: 1, nextCheckAt: 1 })
export const DomainRecord = model('DomainRecord', domainRecordSchema)
