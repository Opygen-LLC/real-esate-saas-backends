import { Schema, model } from 'mongoose'

const impersonationSessionSchema = new Schema({
  adminUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  targetUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  organizationId: { type: String, required: true, index: true },
  reason: { type: String, required: true, maxlength: 500 },
  readOnly: { type: Boolean, default: true },
  startedAt: { type: Date, default: Date.now, required: true },
  expiresAt: { type: Date, required: true, index: true },
  endedAt: { type: Date, default: null },
  endedBy: { type: String, default: '' },
  requestId: { type: String, default: '' },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
}, { timestamps: true })
impersonationSessionSchema.index({ adminUserId: 1, endedAt: 1, expiresAt: -1 })
export const ImpersonationSession = model('ImpersonationSession', impersonationSessionSchema)
