import { Schema, model } from 'mongoose'

const metaEventSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  eventName: { type: String, enum: ['PageView', 'ViewContent', 'Search', 'Lead', 'Contact', 'Schedule'], required: true },
  eventId: { type: String, required: true },
  eventTime: { type: Number, required: true },
  eventSourceUrl: { type: String, required: true },
  userData: { type: Schema.Types.Mixed, default: {} },
  clientIpEncrypted: { type: String, default: '' },
  clientUserAgent: { type: String, default: '' },
  customData: { type: Schema.Types.Mixed, default: {} },
  testEventCode: { type: String, default: '' },
  status: { type: String, enum: ['queued', 'processing', 'sent', 'dead'], default: 'queued', index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lastErrorCode: { type: String, default: '' },
  lastErrorMessage: { type: String, default: '' },
  sentAt: { type: Date, default: null },
  processingStartedAt: { type: Date, default: null, index: true },
  accessDeferredAt: { type: Date, default: null, index: true },
}, { timestamps: true })

metaEventSchema.index({ organizationId: 1, eventId: 1, eventName: 1 }, { unique: true })
metaEventSchema.index({ status: 1, accessDeferredAt: 1, nextAttemptAt: 1 })
export const MetaEvent = model('MetaEvent', metaEventSchema)
