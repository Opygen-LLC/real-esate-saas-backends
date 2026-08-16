import { Schema, model, Types } from 'mongoose'

export interface ISuperAdminProfile {
  userId: Types.ObjectId
  title?: string
  createdAt?: Date
  updatedAt?: Date
}

const superAdminProfileSchema = new Schema<ISuperAdminProfile>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  title: { type: String, default: 'Platform Administrator', maxlength: 120 },
}, { timestamps: true, versionKey: false })

superAdminProfileSchema.index({ userId: 1 }, { unique: true, name: 'super_admin_profile_user_unique' })

export const SuperAdminProfile = model<ISuperAdminProfile>('SuperAdminProfile', superAdminProfileSchema)
