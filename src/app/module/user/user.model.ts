import { Schema, model } from 'mongoose'
import { IUser, UserModel } from './user.interface'

const userSchema = new Schema<IUser, UserModel>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phoneNumber: { type: String, required: true, trim: true },
    organizationId: { type: String, required: true, index: true },
    userRole: {
      type: String,
      required: true,
      enum: ['super-admin', 'agency_owner', 'agency_admin', 'agent', 'staff', 'viewer', 'user'],
      default: 'agent',
      index: true,
    },
    status: { type: String, enum: ['pending', 'active', 'blocked'], default: 'pending', index: true },
    isVerified: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.profile
        delete ret.agentProfile
        delete ret.agencyOwnerProfile
        delete ret.superAdminProfile
        return ret
      },
    },
    toObject: { virtuals: true },
  },
)

// Login identifiers are platform-wide, so uniqueness is intentionally global.
userSchema.index({ phoneNumber: 1 }, { unique: true, name: 'user_phone_unique' })
userSchema.index({ email: 1 }, { unique: true, name: 'user_email_unique' })
userSchema.index({ organizationId: 1, userRole: 1, status: 1 }, { name: 'user_tenant_role_status' })

// One-to-one companion records. These virtuals intentionally keep the core
// User collection small while allowing focused queries to populate profiles.
userSchema.virtual('profile', {
  ref: 'UserProfile', localField: '_id', foreignField: 'userId', justOne: true,
})
userSchema.virtual('agencyOwnerProfile', {
  ref: 'AgencyOwnerProfile', localField: '_id', foreignField: 'userId', justOne: true,
})
userSchema.virtual('agentProfile', {
  ref: 'AgentProfile', localField: '_id', foreignField: 'userId', justOne: true,
})
userSchema.virtual('superAdminProfile', {
  ref: 'SuperAdminProfile', localField: '_id', foreignField: 'userId', justOne: true,
})


const commonProfileField = (field: string, fallback: unknown) => function (this: any) {
  return this.profile?.[field] ?? fallback
}
const roleProfileField = (field: string, fallback: unknown) => function (this: any) {
  const roleProfile = this.userRole === 'agency_owner' ? this.agencyOwnerProfile : this.agentProfile
  return roleProfile?.[field] ?? fallback
}
userSchema.virtual('profileImgURL').get(commonProfileField('profileImgURL', ''))
userSchema.virtual('bio').get(commonProfileField('bio', ''))
userSchema.virtual('licenseNumber').get(roleProfileField('licenseNumber', ''))
userSchema.virtual('specialization').get(roleProfileField('specialization', []))
userSchema.virtual('serviceAreas').get(roleProfileField('serviceAreas', []))

export const User = model<IUser, UserModel>('User', userSchema)
