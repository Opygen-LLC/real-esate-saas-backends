import { Schema, model } from 'mongoose'

const metaIntegrationSchema = new Schema({
  organizationId: { type: String, required: true, unique: true, index: true },
  pixelId: { type: String, required: true, trim: true },
  accessTokenEncrypted: { type: String, required: true, select: false },
  testEventCode: { type: String, default: '' },
  status: { type: String, enum: ['active', 'disabled', 'error'], default: 'active' },
  consentRequired: { type: Boolean, default: true },
  enableSchedule: { type: Boolean, default: true },
  lastTestAt: { type: Date, default: null },
  lastSuccessAt: { type: Date, default: null },
  diagnostics: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true })

export const MetaIntegration = model('MetaIntegration', metaIntegrationSchema)
