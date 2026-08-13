import { Schema, model } from 'mongoose'

export type OtpPurpose = 'account_verification' | 'password_reset'

const otpChallengeSchema = new Schema({
  phoneNumber: { type: String, required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  purpose: { type: String, enum: ['account_verification', 'password_reset'], required: true, index: true },
  codeHash: { type: String, required: true }, attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 }, expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null }, resetTokenHash: { type: String, default: '' },
  resetTokenExpiresAt: { type: Date, default: null }, resetTokenUsedAt: { type: Date, default: null },
  requestIp: { type: String, default: '' },
}, { timestamps: true })

otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 })
otpChallengeSchema.index({ phoneNumber: 1, purpose: 1, createdAt: -1 })
export const OtpChallenge = model('OtpChallenge', otpChallengeSchema)
