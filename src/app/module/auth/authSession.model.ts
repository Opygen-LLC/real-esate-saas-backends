import { Schema, model } from 'mongoose'

const authSessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  organizationId: { type: String, required: true, index: true }, familyId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true }, expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null }, revokeReason: { type: String, default: '' },
  lastUsedAt: { type: Date, default: Date.now }, createdIp: { type: String, default: '' },
  userAgent: { type: String, default: '' },
}, { timestamps: true })

authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
export const AuthSession = model('AuthSession', authSessionSchema)
