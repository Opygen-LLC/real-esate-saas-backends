import { Schema, model, Types } from 'mongoose'

export interface IAccountCredential {
  userId: Types.ObjectId
  passwordHash: string
  passwordChangedAt: Date
  emailVerifiedAt?: Date | null
  phoneVerifiedAt?: Date | null
  failedLoginCount: number
  lockedUntil?: Date | null
  lastLoginAt?: Date | null
  lastLoginIp?: string
  createdAt?: Date
  updatedAt?: Date
}

const accountCredentialSchema = new Schema<IAccountCredential>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  passwordHash: { type: String, required: true, select: false },
  passwordChangedAt: { type: Date, required: true, default: Date.now },
  emailVerifiedAt: { type: Date, default: null },
  phoneVerifiedAt: { type: Date, default: null },
  failedLoginCount: { type: Number, min: 0, default: 0 },
  lockedUntil: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
  lastLoginIp: { type: String, default: '', maxlength: 128 },
}, {
  timestamps: true,
  versionKey: false,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.passwordHash
      return ret
    },
  },
  toObject: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.passwordHash
      return ret
    },
  },
})

accountCredentialSchema.index({ userId: 1 }, { unique: true, name: 'account_credential_user_unique' })
accountCredentialSchema.index({ lockedUntil: 1 }, { sparse: true, name: 'account_credential_lock_lookup' })

export const AccountCredential = model<IAccountCredential>('AccountCredential', accountCredentialSchema)
