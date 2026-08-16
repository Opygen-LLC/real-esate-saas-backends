import bcrypt from 'bcryptjs'
import { Schema, model } from 'mongoose'
import { IUser, UserModel } from './user.interface'
import { permissionValues } from './accessControl'

const userSchema = new Schema<IUser, UserModel>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    organizationId: {
      type: String,
      required: true,
      index: true,
    },
    userRole: {
      type: String,
      required: true,
      enum: [
        'super-admin',
        'agency_owner',
        'agency_admin',
        'agent',
        'staff',
        'viewer',
        'user',
      ],
      default: 'agent',
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'blocked'],
      default: 'pending',
    },
    profileImgURL: {
      type: String,
      default: '',
    },
    bio: {
      type: String,
      default: '',
    },
    licenseNumber: {
      type: String,
      default: '',
    },
    specialization: {
      type: [String],
      default: [],
    },
    serviceAreas: {
      type: [String],
      default: [],
    },
    address: {
      type: String,
      default: '',
    },
    gender: {
      type: String,
      default: '',
    },
    verificationCode: {
      type: String,
      default: '',
      select: false,
    },
    codeGenerationTimestamp: {
      type: String,
      default: '',
      select: false,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isAddProfile: {
      type: Boolean,
      default: true,
    },
    sidebar_permission: {
      type: Object,
      default: {},
    },
    accessControl: {
      useRoleDefaults: { type: Boolean, default: true },
      permissions: { type: [String], enum: permissionValues, default: [] },
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.password
        delete ret.verificationCode
        delete ret.codeGenerationTimestamp
        return ret
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.password
        delete ret.verificationCode
        delete ret.codeGenerationTimestamp
        return ret
      },
    },
  }
)

// Login identifiers are platform-wide, so uniqueness is intentionally global.
userSchema.index({ phoneNumber: 1 }, { unique: true })
userSchema.index({ email: 1 }, { unique: true })
userSchema.index({ organizationId: 1, _id: 1 })

userSchema.statics.isUserExist = async function (
  phoneNumber: string
): Promise<Pick<IUser, 'phoneNumber' | 'password' | 'userRole' | 'isVerified'> | null> {
  return await this.findOne({ phoneNumber }).select('+password phoneNumber userRole isVerified')
}

userSchema.statics.isPasswordMatch = async function (
  givenPassword: string,
  savedPassword: string
): Promise<boolean> {
  return await bcrypt.compare(givenPassword, savedPassword)
}
userSchema.index({ organizationId: 1, userRole: 1, status: 1 })

export const User = model<IUser, UserModel>('User', userSchema)
