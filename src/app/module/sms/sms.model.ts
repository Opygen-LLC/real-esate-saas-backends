import { Schema, model } from 'mongoose'

const smsTemplateSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  key: { type: String, required: true },
  name: { type: String, required: true },
  body: { type: String, required: true, maxlength: 480 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true })
smsTemplateSchema.index({ organizationId: 1, key: 1 }, { unique: true })
export const SmsTemplate = model('SmsTemplate', smsTemplateSchema)

const smsOptOutSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  phone: { type: String, required: true },
  reason: { type: String, default: 'user_request' },
  optedOutAt: { type: Date, default: Date.now },
}, { timestamps: true })
smsOptOutSchema.index({ organizationId: 1, phone: 1 }, { unique: true })
export const SmsOptOut = model('SmsOptOut', smsOptOutSchema)

const smsMessageSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  provider: { type: String, required: true },
  providerMessageId: { type: String, default: '', index: true },
  phone: { type: String, required: true, index: true },
  templateKey: { type: String, default: '' },
  message: { type: String, required: true, maxlength: 480 },
  status: { type: String, enum: ['accepted', 'sent', 'delivered', 'failed', 'rejected'], default: 'accepted', index: true },
  cost: { type: Number, default: 0 },
  currency: { type: String, default: 'BDT' },
  leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
  sentBy: { type: Schema.Types.ObjectId, ref: 'User' },
  deliveredAt: Date,
  failedAt: Date,
  failureCode: { type: String, default: '' },
}, { timestamps: true })
smsMessageSchema.index({ organizationId: 1, createdAt: -1 })
export const SmsMessage = model('SmsMessage', smsMessageSchema)
