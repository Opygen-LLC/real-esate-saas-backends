import { Schema, model, Types } from 'mongoose'

export interface IAuthSession {
  userId: Types.ObjectId
  organizationId: string
  familyId: string
  refreshTokenHash?: string
  /** @deprecated migration-only compatibility; removed by Phase 1 migration. */
  tokenHash?: string
  expiresAt: Date
  revokedAt?: Date | null
  revokeReason?: string
  lastUsedAt?: Date
  lastUsedIp?: string
  createdIp?: string
  userAgent?: string
  rotatedAt?: Date | null
  sessionVersion: number
  createdAt?: Date
  updatedAt?: Date
}

const authSessionSchema = new Schema<IAuthSession>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true, immutable: true },
  organizationId: { type: String, required: true, index: true, immutable: true },
  familyId: { type: String, required: true, index: true, immutable: true },
  refreshTokenHash: { type: String, default: '', select: false },
  tokenHash: { type: String, default: '', select: false },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null, index: true },
  revokeReason: { type: String, default: '', maxlength: 120 },
  lastUsedAt: { type: Date, default: Date.now },
  lastUsedIp: { type: String, default: '', maxlength: 128 },
  createdIp: { type: String, default: '', maxlength: 128 },
  userAgent: { type: String, default: '', maxlength: 1000 },
  rotatedAt: { type: Date, default: null },
  sessionVersion: { type: Number, min: 1, default: 1 },
}, {
  timestamps: true,
  versionKey: false,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.refreshTokenHash
      delete ret.tokenHash
      return ret
    },
  },
  toObject: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.refreshTokenHash
      delete ret.tokenHash
      return ret
    },
  },
})

authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'auth_session_expiry_ttl' })
authSessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: -1 }, { name: 'auth_session_user_active_lookup' })
authSessionSchema.index({ familyId: 1, revokedAt: 1 }, { name: 'auth_session_family_lookup' })
authSessionSchema.index({ organizationId: 1, revokedAt: 1 }, { name: 'auth_session_tenant_active_lookup' })

export const AuthSession = model<IAuthSession>('AuthSession', authSessionSchema)
