import { Model } from 'mongoose'

export type IUserRole =
  | 'super-admin'
  | 'agency_owner'
  | 'agency_admin'
  | 'agent'
  | 'staff'
  | 'viewer'
  | 'user'

/**
 * Core identity only. Authentication secrets and profile/role metadata live in
 * one-to-one companion collections.
 */
export interface IUser {
  name: string
  email: string
  phoneNumber: string
  organizationId: string
  userRole: IUserRole
  status: 'pending' | 'active' | 'blocked'
  accessRestriction?: {
    source: 'subscription_quota' | 'tenant_admin' | 'platform_admin'
    reason: string
    blockedAt: Date
    blockedBy: string
    previousStatus: 'pending' | 'active'
  } | null
  isVerified: boolean
  createdAt?: Date
  updatedAt?: Date
}

export interface IUserProfileInput {
  profileImgURL?: string
  bio?: string
  licenseNumber?: string
  showAsLicensedBroker?: boolean
  specialization?: string[]
  serviceAreas?: string[]
  address?: string
  gender?: string
  isAddProfile?: boolean
  sidebar_permission?: Record<string, boolean>
  accessControl?: { useRoleDefaults: boolean; permissions: string[] }
}

export type IUserCreateInput = IUser & IUserProfileInput & { password?: string }
export type IUserUpdateInput = Partial<Pick<IUser, 'name'>> & IUserProfileInput

export type IUserFilter = {
  searchTerm?: string
  organizationId?: string
  userRole?: string
  status?: string
}

export type UserModel = Model<IUser>
