import { Schema, model, Types } from 'mongoose'
import { permissionValues } from '../user/accessControl'

export interface IUserProfileDocument {
  userId: Types.ObjectId
  profileImgURL?: string
  bio?: string
  address?: string
  gender?: string
  isAddProfile: boolean
  sidebarPermission?: Record<string, boolean>
  accessControl: { useRoleDefaults: boolean; permissions: string[] }
  createdAt?: Date
  updatedAt?: Date
}

const userProfileSchema = new Schema<IUserProfileDocument>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  profileImgURL: { type: String, default: '' },
  bio: { type: String, default: '', maxlength: 1000 },
  address: { type: String, default: '', maxlength: 300 },
  gender: { type: String, default: '', maxlength: 30 },
  isAddProfile: { type: Boolean, default: true },
  sidebarPermission: { type: Schema.Types.Mixed, default: {} },
  accessControl: {
    useRoleDefaults: { type: Boolean, default: true },
    permissions: { type: [String], enum: permissionValues, default: [] },
  },
}, { timestamps: true, versionKey: false })

userProfileSchema.index({ userId: 1 }, { unique: true, name: 'user_profile_user_unique' })

export const UserProfile = model<IUserProfileDocument>('UserProfile', userProfileSchema)
