import { Schema, model, Types } from 'mongoose'

export type OtpPurpose = 'account_verification' | 'password_reset'
export type OtpChannel = 'email' | 'sms'

export interface IOtpChallenge {
  phoneNumber?: string
  email?: string
  channel: OtpChannel
  userId?: Types.ObjectId
  organizationId?: string
  purpose: OtpPurpose
  codeHash: string
  attempts: number
  maxAttempts: number
  expiresAt: Date
  consumedAt?: Date | null
  consumedIp?: string
  lastAttemptAt?: Date | null
  resetTokenHash?: string
  resetTokenIssuedAt?: Date | null
  resetTokenExpiresAt?: Date | null
  resetTokenUsedAt?: Date | null
  requestIp?: string
  requestUserAgent?: string
  createdAt?: Date
  updatedAt?: Date
}

const otpChallengeSchema = new Schema<IOtpChallenge>({
  // SMS remains supported by the model for future provider rollout, while the
  // current production authentication flow is email-first.
  phoneNumber: { type: String, default: '', index: true },
  email: { type: String, default: '', lowercase: true, trim: true, index: true },
  channel: { type: String, enum: ['email', 'sms'], default: 'email', index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  organizationId: { type: String, default: '', index: true },
  purpose: { type: String, enum: ['account_verification', 'password_reset'], required: true, index: true },
  codeHash: { type: String, required: true, select: false },
  attempts: { type: Number, min: 0, default: 0 },
  maxAttempts: { type: Number, min: 1, max: 20, default: 5 },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null, index: true },
  consumedIp: { type: String, default: '', maxlength: 128 },
  lastAttemptAt: { type: Date, default: null },
  resetTokenHash: { type: String, default: '', select: false },
  resetTokenIssuedAt: { type: Date, default: null },
  resetTokenExpiresAt: { type: Date, default: null },
  resetTokenUsedAt: { type: Date, default: null },
  requestIp: { type: String, default: '', maxlength: 128 },
  requestUserAgent: { type: String, default: '', maxlength: 1000 },
}, {
  timestamps: true,
  versionKey: false,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.codeHash
      delete ret.resetTokenHash
      return ret
    },
  },
  toObject: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.codeHash
      delete ret.resetTokenHash
      return ret
    },
  },
})

// Retain challenges for 24h after expiry for security/audit troubleshooting,
// then allow MongoDB TTL cleanup to remove them automatically.
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400, name: 'otp_challenge_expiry_ttl' })
otpChallengeSchema.index({ email: 1, purpose: 1, channel: 1, createdAt: -1 }, { name: 'otp_challenge_email_lookup' })
otpChallengeSchema.index({ phoneNumber: 1, purpose: 1, channel: 1, createdAt: -1 }, { name: 'otp_challenge_phone_lookup' })
otpChallengeSchema.index({ userId: 1, purpose: 1, consumedAt: 1, createdAt: -1 }, { name: 'otp_challenge_user_lookup' })

export const OtpChallenge = model<IOtpChallenge>('OtpChallenge', otpChallengeSchema)
