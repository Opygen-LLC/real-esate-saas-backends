import { Schema, model } from 'mongoose'

const whatsappIntegrationSchema = new Schema({
  organizationId: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ['disabled', 'pending_approval', 'connected', 'error'], default: 'disabled' },
  entitlementStatus: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
  entitlementSuspendedAt: { type: Date, default: null },
  businessAccountId: { type: String, default: '' },
  phoneNumberId: { type: String, default: '' },
  encryptedAccessToken: { type: String, default: '', select: false },
  displayPhoneNumber: { type: String, default: '' },
  lastTestAt: Date,
  lastError: { type: String, default: '' },
  diagnostics: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true })
export const WhatsAppIntegration = model('WhatsAppIntegration', whatsappIntegrationSchema)
