import { Schema, model } from 'mongoose'

export const DOMAIN_LIFECYCLE_STATUSES = [
  'PENDING_DNS',
  'OWNERSHIP_VERIFIED',
  'ROUTING_VERIFIED',
  'TLS_PROVISIONING',
  'ACTIVE',
] as const

export type DomainLifecycleStatus = typeof DOMAIN_LIFECYCLE_STATUSES[number]
export type DomainStatus = 'pending' | 'verified' | 'failed'
export type TlsStatus = 'not_started' | 'provisioning' | 'active' | 'failed'

const domainRecordSchema = new Schema({
  organizationId: { type: String, required: true, unique: true, index: true },
  domain: { type: String, required: true, unique: true, index: true },
  ownershipToken: { type: String, required: true },

  // Canonical Phase 9 lifecycle. The legacy status/tlsStatus fields remain for
  // rolling compatibility with older organization/public-site read paths.
  lifecycleStatus: { type: String, enum: DOMAIN_LIFECYCLE_STATUSES, default: 'PENDING_DNS', index: true },
  provider: { type: String, default: 'vercel' },
  providerRegistrationStatus: { type: String, enum: ['pending', 'registered', 'failed'], default: 'pending' },
  publicRoutingStatus: { type: String, enum: ['pending', 'active', 'failed'], default: 'pending' },
  status: { type: String, enum: ['pending', 'verified', 'failed'], default: 'pending', index: true },
  tlsStatus: { type: String, enum: ['not_started', 'provisioning', 'active', 'failed'], default: 'not_started' },

  providerRequestId: { type: String, default: '' },
  requiredDns: { type: [Schema.Types.Mixed], default: [] },
  diagnostics: { type: [Schema.Types.Mixed], default: [] },
  failureReason: { type: String, default: '' },
  failureCount: { type: Number, default: 0 },

  lastCheckedAt: { type: Date, default: null },
  nextCheckAt: { type: Date, default: Date.now, index: true },
  ownershipVerifiedAt: { type: Date, default: null },
  routingVerifiedAt: { type: Date, default: null },
  providerRegisteredAt: { type: Date, default: null },
  tlsActiveAt: { type: Date, default: null },
  activeAt: { type: Date, default: null },
  // Legacy compatibility timestamp used by older operational screens.
  verifiedAt: { type: Date, default: null },
}, { timestamps: true })

domainRecordSchema.index({ lifecycleStatus: 1, nextCheckAt: 1 })
domainRecordSchema.index({ status: 1, nextCheckAt: 1 })
export const DomainRecord = model('DomainRecord', domainRecordSchema)
