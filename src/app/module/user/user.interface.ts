import { Model } from 'mongoose'

export type IUserRole =
  | 'super-admin'
  | 'agency_owner'
  | 'agency_admin'
  | 'agent'
  | 'viewer'
  | 'user'

export interface IUser {
  name: string
  email: string
  phoneNumber: string
  password?: string
  organizationId: string
  userRole: IUserRole
  status: 'pending' | 'active' | 'blocked'
  profileImgURL?: string
  bio?: string
  licenseNumber?: string
  specialization?: string[]
  serviceAreas?: string[]
  address?: string
  gender?: string
  verificationCode?: string
  codeGenerationTimestamp?: string
  isVerified: boolean
  isAddProfile: boolean
  sidebar_permission?: Record<string, boolean>
  createdAt?: Date
  updatedAt?: Date
}

export type IUserFilter = {
  searchTerm?: string
  organizationId?: string
  userRole?: string
  status?: string
}

export type UserModel = {
  isUserExist(
    phoneNumber: string
  ): Promise<Pick<IUser, 'phoneNumber' | 'password' | 'userRole' | 'isVerified'> | null>
  isPasswordMatch(givenPassword: string, savedPassword: string): Promise<boolean>
} & Model<IUser>
