import { Schema, model } from 'mongoose'

const metaIntegrationSchema = new Schema({
  organizationId: { type: String, required: true, unique: true, index: true },
  pixelId: { type: String, required: true, trim: true },

  // Phase 3: browser Pixel and CAPI are independent capabilities. These fields
  // intentionally have no schema defaults so legacy documents can be detected
  // and derived safely during a rolling deployment before the migration runs.
  pixelEnabled: { type: Boolean },
  capiEnabled: { type: Boolean },
  capiStatus: { type: String, enum: ['not_configured', 'active', 'disabled', 'error'] },

  accessTokenEncrypted: { type: String, default: '', select: false },
  testEventCode: { type: String, default: '' },

  // Kept for backward compatibility with pre-Phase-3 records and clients. New
  // code never uses this field to couple browser Pixel health to CAPI health.
  status: { type: String, enum: ['active', 'disabled', 'error'], default: 'active' },

  consentRequired: { type: Boolean, default: true },
  enableSchedule: { type: Boolean, default: true },
  lastTestAt: { type: Date, default: null },
  lastSuccessAt: { type: Date, default: null },
  diagnostics: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true })

export const MetaIntegration = model('MetaIntegration', metaIntegrationSchema)
