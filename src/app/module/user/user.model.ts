import bcrypt from 'bcryptjs'
import { Schema, model } from 'mongoose'
import { IUser, UserModel } from './user.interface'

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
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
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
        'viewer',
        'user',
        'admin',
        'client',
        'staff',
      ],
      default: 'agent',
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'blocked'],
      default: 'active',
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
    },
    codeGenerationTimestamp: {
      type: String,
      default: '',
    },
    isVerified: {
      type: Boolean,
      default: true,
    },
    isAddProfile: {
      type: Boolean,
      default: true,
    },
    sidebar_permission: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
    },
  }
)

userSchema.index({ organizationId: 1, phoneNumber: 1 }, { unique: true })
userSchema.index({ organizationId: 1, email: 1 }, { unique: true })

userSchema.statics.isUserExist = async function (
  phoneNumber: string
): Promise<Pick<IUser, 'phoneNumber' | 'password' | 'userRole' | 'isVerified'> | null> {
  return await this.findOne({ phoneNumber }, { phoneNumber: 1, password: 1, userRole: 1, isVerified: 1 })
}

userSchema.statics.isPasswordMatch = async function (
  givenPassword: string,
  savedPassword: string
): Promise<boolean> {
  return await bcrypt.compare(givenPassword, savedPassword)
}

export const User = model<IUser, UserModel>('User', userSchema)
