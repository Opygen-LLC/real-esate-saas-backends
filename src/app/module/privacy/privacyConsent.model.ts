import { Schema, model, models } from 'mongoose'
import { IPrivacyConsentRecord } from './privacyConsent.interface'

const privacyConsentSchema = new Schema<IPrivacyConsentRecord>(
  {
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    purpose: { type: String, enum: ['service_terms', 'privacy_policy', 'marketing'], required: true },
    policyVersion: { type: String, required: true, trim: true },
    granted: { type: Boolean, required: true },
    capturedAt: { type: Date, default: Date.now, index: true },
    ip: { type: String, default: '' },
    requestId: { type: String, default: '' },
  },
  { versionKey: false },
)

privacyConsentSchema.index({ organizationId: 1, purpose: 1, capturedAt: -1 }, { name: 'tenant_purpose_captured' })
privacyConsentSchema.index({ organizationId: 1, userId: 1, purpose: 1, capturedAt: -1 }, { name: 'tenant_user_purpose_captured' })

// Keep the existing Mongoose model/collection name so Phase 0 is a zero-data-migration extraction.
export const PrivacyConsentRecord =
  models.ConsentRecord || model<IPrivacyConsentRecord>('ConsentRecord', privacyConsentSchema)
