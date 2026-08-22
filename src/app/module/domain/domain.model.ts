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

const candidateDomainSchema = new Schema({
  domain: { type: String, required: true },
  ownershipToken: { type: String, required: true },
  lifecycleStatus: { type: String, enum: DOMAIN_LIFECYCLE_STATUSES, default: 'PENDING_DNS' },
  provider: { type: String, default: 'vercel' },
  providerRegistrationStatus: { type: String, enum: ['pending', 'registered', 'failed'], default: 'pending' },
  publicRoutingStatus: { type: String, enum: ['pending', 'active', 'failed'], default: 'pending' },
  status: { type: String, enum: ['pending', 'verified', 'failed'], default: 'pending' },
  tlsStatus: { type: String, enum: ['not_started', 'provisioning', 'active', 'failed'], default: 'not_started' },
  providerRequestId: { type: String, default: '' },
  requiredDns: { type: [Schema.Types.Mixed], default: [] },
  diagnostics: { type: [Schema.Types.Mixed], default: [] },
  failureReason: { type: String, default: '' },
  failureCount: { type: Number, default: 0 },
  lastCheckedAt: { type: Date, default: null },
  nextCheckAt: { type: Date, default: Date.now },
  ownershipVerifiedAt: { type: Date, default: null },
  routingVerifiedAt: { type: Date, default: null },
  providerRegisteredAt: { type: Date, default: null },
  tlsActiveAt: { type: Date, default: null },
  activeAt: { type: Date, default: null },
  verifiedAt: { type: Date, default: null },
}, { _id: false })

const retiredDomainSchema = new Schema({
  domain: { type: String, required: true },
  redirectStartedAt: { type: Date, required: true },
  retireAfter: { type: Date, required: true },
  providerRemovedAt: { type: Date, default: null },
  lastRemovalAttemptAt: { type: Date, default: null },
  removalError: { type: String, default: '', maxlength: 500 },
}, { _id: false })

const domainRecordSchema = new Schema({
  organizationId: { type: String, required: true, unique: true, index: true },
  domain: { type: String, required: true, unique: true, index: true },
  ownershipToken: { type: String, required: true },
  entitlementStatus: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
  entitlementSuspendedAt: { type: Date, default: null },
  entitlementSuspendedReason: { type: String, default: '', maxlength: 500 },

  // Canonical lifecycle for the currently serving domain. A replacement is
  // staged in candidate until every DNS/TLS/runtime check passes, so the
  // existing ACTIVE hostname stays online during cutover.
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
  verifiedAt: { type: Date, default: null },

  candidate: { type: candidateDomainSchema, default: null },
  retiredDomains: { type: [retiredDomainSchema], default: [] },
}, { timestamps: true })

domainRecordSchema.index({ lifecycleStatus: 1, nextCheckAt: 1 })
domainRecordSchema.index({ status: 1, nextCheckAt: 1 })
domainRecordSchema.index({ 'candidate.domain': 1 }, { unique: true, partialFilterExpression: { 'candidate.domain': { $type: 'string' } } })
domainRecordSchema.index({ 'retiredDomains.domain': 1 })
domainRecordSchema.index({ 'retiredDomains.retireAfter': 1 })

export const DomainRecord = model('DomainRecord', domainRecordSchema)
