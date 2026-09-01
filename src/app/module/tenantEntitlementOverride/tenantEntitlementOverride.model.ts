import mongoose, { Model, Schema } from 'mongoose'
import type { ITenantEntitlementOverride } from './tenantEntitlementOverride.interface'

const numericOverrideSchema = new Schema({
  mode: { type: String, enum: ['add', 'set'], required: true },
  value: { type: Number, required: true, min: 0 },
}, { _id: false })

const tenantEntitlementOverrideSchema = new Schema<ITenantEntitlementOverride>({
  organizationId: { type: String, required: true, trim: true, index: true },
  version: { type: Number, required: true, min: 1 },
  activeKey: { type: String, default: undefined },
  status: { type: String, enum: ['active', 'revoked', 'expired'], required: true, default: 'active', index: true },
  resources: {
    leads: { type: numericOverrideSchema, default: undefined },
    properties: { type: numericOverrideSchema, default: undefined },
    teamMembers: { type: numericOverrideSchema, default: undefined },
    storageMb: { type: numericOverrideSchema, default: undefined },
    monthlyVisitors: { type: numericOverrideSchema, default: undefined },
  },
  features: {
    customDomain: { type: Boolean, default: undefined },
    advancedAnalytics: { type: Boolean, default: undefined },
    whatsappIntegration: { type: Boolean, default: undefined },
    smsAutomation: { type: Boolean, default: undefined },
    leadAutomations: { type: Boolean, default: undefined },
    premiumTemplates: { type: Boolean, default: undefined },
    advancedAccounting: { type: Boolean, default: undefined },
  },
  startsAt: { type: Date, required: true, default: Date.now, index: true },
  expiresAt: { type: Date, default: null, index: true },
  reason: { type: String, required: true, trim: true, minlength: 10, maxlength: 500 },
  createdBy: { type: String, required: true, trim: true },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: String, default: '' },
  revokeReason: { type: String, default: '', maxlength: 500 },
}, { timestamps: true, versionKey: false })

tenantEntitlementOverrideSchema.index({ organizationId: 1, version: 1 }, { unique: true, name: 'tenant_entitlement_override_version_unique' })
tenantEntitlementOverrideSchema.index({ activeKey: 1 }, { unique: true, sparse: true, name: 'tenant_entitlement_override_one_active' })
tenantEntitlementOverrideSchema.index({ organizationId: 1, status: 1, startsAt: -1, _id: -1 }, { name: 'tenant_entitlement_override_history' })

export const TenantEntitlementOverride: Model<ITenantEntitlementOverride> = mongoose.models.TenantEntitlementOverride
  || mongoose.model<ITenantEntitlementOverride>('TenantEntitlementOverride', tenantEntitlementOverrideSchema)
