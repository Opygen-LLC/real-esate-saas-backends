import { IUserRole } from './user.interface'

export interface UserAccessControlDto {
  useRoleDefaults: boolean
  permissions: string[]
}

export interface UserAccessRestrictionDto {
  source: 'subscription_quota' | 'tenant_admin' | 'platform_admin'
  reason: string
  blockedAt: Date | string
  blockedBy: string
  previousStatus: 'pending' | 'active'
}

export interface UserResponseDto {
  _id: string
  name: string
  email: string
  phoneNumber: string
  organizationId: string
  userRole: IUserRole
  status: 'pending' | 'active' | 'blocked'
  accessRestriction?: UserAccessRestrictionDto | null
  isVerified: boolean
  profileImgURL: string
  bio: string
  licenseNumber: string
  showAsLicensedBroker: boolean
  specialization: string[]
  serviceAreas: string[]
  isAddProfile: boolean
  createdAt?: Date | string
  updatedAt?: Date | string
  address?: string
  gender?: string
  sidebar_permission?: Record<string, boolean>
  accessControl?: UserAccessControlDto
  permissions?: string[]
  title?: string
}

export interface AuthUserResponseDto {
  _id: string
  name: string
  email: string
  phoneNumber: string
  userRole: IUserRole
  organizationId: string
  status: 'pending' | 'active' | 'blocked'
  isVerified: boolean
  profileImgURL: string
  licenseNumber: string
  specialization: string[]
  permissions: string[]
  authorizationUpdatedAt?: string
}

export interface PublicAgentResponseDto {
  _id: string
  name: string
  email: string
  phoneNumber: string
  profileImgURL: string
  licenseNumber: string
  bio: string
  specialization: string[]
}
