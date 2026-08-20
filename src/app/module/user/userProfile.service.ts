import mongoose, { ClientSession, Types } from 'mongoose'
import { AgencyOwnerProfile } from '../agencyOwnerProfile/agencyOwnerProfile.model'
import { AgentProfile } from '../agentProfile/agentProfile.model'
import { SuperAdminProfile } from '../superAdminProfile/superAdminProfile.model'
import { UserProfile } from '../userProfile/userProfile.model'
import { effectivePermissionsForUser } from './accessControl'
import { AuthUserResponseDto, PublicAgentResponseDto, UserResponseDto } from './user.dto'
import { IUserProfileInput, IUserRole } from './user.interface'

export const USER_PROFILE_POPULATES = [
  { path: 'profile', select: 'profileImgURL bio address gender isAddProfile sidebarPermission accessControl' },
  { path: 'agencyOwnerProfile', select: 'organizationId licenseNumber showAsLicensedBroker specialization serviceAreas' },
  { path: 'agentProfile', select: 'organizationId licenseNumber showAsLicensedBroker specialization serviceAreas' },
  { path: 'superAdminProfile', select: 'title' },
]

export const userRefPopulate = (path: string, select = '_id name email phoneNumber organizationId userRole status isVerified') => ({
  path,
  select,
  populate: USER_PROFILE_POPULATES,
})

const asPlain = (value: any): any => {
  if (!value) return value
  if (typeof value.toObject === 'function') return value.toObject({ virtuals: true, transform: false })
  return value
}

const roleProfileFrom = (user: any) => {
  if (user?.userRole === 'agency_owner') return asPlain(user.agencyOwnerProfile)
  if (user?.userRole === 'super-admin') return asPlain(user.superAdminProfile)
  return asPlain(user?.agentProfile)
}

export interface UserDtoOptions {
  includeAccessControl?: boolean
  includePrivateProfile?: boolean
  includePermissions?: boolean
}

export const toUserDto = (source: any, options: UserDtoOptions = {}): UserResponseDto => {
  const user = asPlain(source) || {}
  const profile = asPlain(user.profile) || {}
  const roleProfile = roleProfileFrom(user) || {}
  const accessControl = profile.accessControl || { useRoleDefaults: true, permissions: [] }
  const dto: UserResponseDto = {
    _id: String(user._id),
    name: user.name,
    email: user.email,
    phoneNumber: user.phoneNumber,
    organizationId: user.organizationId,
    userRole: user.userRole,
    status: user.status,
    accessRestriction: user.accessRestriction ? {
      source: user.accessRestriction.source,
      reason: user.accessRestriction.reason || '',
      blockedAt: user.accessRestriction.blockedAt,
      blockedBy: user.accessRestriction.blockedBy || '',
      previousStatus: user.accessRestriction.previousStatus === 'pending' ? 'pending' : 'active',
    } : null,
    isVerified: Boolean(user.isVerified),
    profileImgURL: profile.profileImgURL || '',
    bio: profile.bio || '',
    licenseNumber: roleProfile.licenseNumber || '',
    showAsLicensedBroker: roleProfile.showAsLicensedBroker === true,
    specialization: Array.isArray(roleProfile.specialization) ? roleProfile.specialization : [],
    serviceAreas: Array.isArray(roleProfile.serviceAreas) ? roleProfile.serviceAreas : [],
    isAddProfile: profile.isAddProfile !== false,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
  if (options.includePrivateProfile) {
    dto.address = profile.address || ''
    dto.gender = profile.gender || ''
    dto.sidebar_permission = profile.sidebarPermission || {}
  }
  if (options.includeAccessControl) dto.accessControl = accessControl
  if (options.includePermissions) dto.permissions = effectivePermissionsForUser({ userRole: user.userRole, accessControl })
  if (user.userRole === 'super-admin' && roleProfile.title) dto.title = roleProfile.title
  return dto
}

export const toAuthUserDto = (user: any): AuthUserResponseDto => {
  const dto = toUserDto(user, { includePermissions: true })
  return {
    _id: dto._id,
    name: dto.name,
    email: dto.email,
    phoneNumber: dto.phoneNumber,
    userRole: dto.userRole,
    organizationId: dto.organizationId,
    status: dto.status,
    isVerified: dto.isVerified,
    profileImgURL: dto.profileImgURL,
    licenseNumber: dto.licenseNumber,
    specialization: dto.specialization,
    permissions: dto.permissions || [],
    authorizationUpdatedAt: dto.updatedAt ? new Date(dto.updatedAt).toISOString() : undefined,
  }
}

export const toPublicAgentDto = (user: any): PublicAgentResponseDto => {
  const dto = toUserDto(user)
  return {
    _id: dto._id,
    name: dto.name,
    email: dto.email,
    phoneNumber: dto.phoneNumber,
    profileImgURL: dto.profileImgURL,
    licenseNumber: dto.licenseNumber,
    bio: dto.bio,
    specialization: dto.specialization,
  }
}

export const populateUserProfiles = async <T extends { populate: (arg: any) => Promise<any> }>(user: T): Promise<T> => {
  await user.populate(USER_PROFILE_POPULATES)
  return user
}

export const getUserAccessControl = async (userId: string | Types.ObjectId) => {
  const profile: any = await UserProfile.findOne({ userId }).select('accessControl').lean()
  return profile?.accessControl || { useRoleDefaults: true, permissions: [] }
}

export const getRoleProfileFields = async (userId: string | Types.ObjectId) => {
  const [owner, agent] = await Promise.all([
    AgencyOwnerProfile.findOne({ userId }).select('licenseNumber showAsLicensedBroker specialization serviceAreas').lean(),
    AgentProfile.findOne({ userId }).select('licenseNumber showAsLicensedBroker specialization serviceAreas').lean(),
  ])
  const source: any = owner || agent || {}
  return {
    licenseNumber: source.licenseNumber || '',
    showAsLicensedBroker: source.showAsLicensedBroker === true,
    specialization: Array.isArray(source.specialization) ? source.specialization : [],
    serviceAreas: Array.isArray(source.serviceAreas) ? source.serviceAreas : [],
  }
}

const sessionOption = (session?: ClientSession) => session ? { session } : undefined

export const ensureUserProfile = async (
  userId: string | Types.ObjectId,
  input: IUserProfileInput = {},
  session?: ClientSession,
) => {
  const update: Record<string, unknown> = {
    profileImgURL: input.profileImgURL || '',
    bio: input.bio || '',
    address: input.address || '',
    gender: input.gender || '',
    isAddProfile: input.isAddProfile !== false,
    sidebarPermission: input.sidebar_permission || {},
    accessControl: input.accessControl || { useRoleDefaults: true, permissions: [] },
  }
  return UserProfile.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId }, $set: update },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, ...sessionOption(session) },
  )
}

export const updateUserProfileFields = async (
  userId: string | Types.ObjectId,
  input: IUserProfileInput,
  session?: ClientSession,
) => {
  const set: Record<string, unknown> = {}
  if (input.profileImgURL !== undefined) set.profileImgURL = input.profileImgURL
  if (input.bio !== undefined) set.bio = input.bio
  if (input.address !== undefined) set.address = input.address
  if (input.gender !== undefined) set.gender = input.gender
  if (input.isAddProfile !== undefined) set.isAddProfile = input.isAddProfile
  if (input.sidebar_permission !== undefined) set.sidebarPermission = input.sidebar_permission
  if (input.accessControl !== undefined) set.accessControl = input.accessControl
  if (!Object.keys(set).length) return UserProfile.findOne({ userId }).session(session || null)
  return UserProfile.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId }, $set: set },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, ...sessionOption(session) },
  )
}

export const syncRoleProfile = async (
  userId: string | Types.ObjectId,
  organizationId: string,
  role: IUserRole,
  input: Pick<IUserProfileInput, 'licenseNumber' | 'showAsLicensedBroker' | 'specialization' | 'serviceAreas'> = {},
  session?: ClientSession,
) => {
  const roleFields = {
    licenseNumber: input.licenseNumber || '',
    showAsLicensedBroker: input.showAsLicensedBroker === true,
    specialization: input.specialization || [],
    serviceAreas: input.serviceAreas || [],
  }
  const options = { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, ...sessionOption(session) }

  if (role === 'agency_owner') {
    await AgencyOwnerProfile.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId, organizationId }, $set: roleFields },
      options,
    )
    await Promise.all([
      AgentProfile.deleteOne({ userId }, sessionOption(session)),
      SuperAdminProfile.deleteOne({ userId }, sessionOption(session)),
    ])
    return
  }

  if (role === 'super-admin') {
    await SuperAdminProfile.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId }, $set: { title: 'Platform Administrator' } },
      options,
    )
    await Promise.all([
      AgentProfile.deleteOne({ userId }, sessionOption(session)),
      AgencyOwnerProfile.deleteOne({ userId }, sessionOption(session)),
    ])
    return
  }

  await AgentProfile.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId, organizationId }, $set: roleFields },
    options,
  )
  await Promise.all([
    AgencyOwnerProfile.deleteOne({ userId }, sessionOption(session)),
    SuperAdminProfile.deleteOne({ userId }, sessionOption(session)),
  ])
}

export const updateLicensedBrokerProfile = async (
  userId: string | Types.ObjectId,
  organizationId: string,
  role: IUserRole,
  input: { licenseNumber: string; showAsLicensedBroker: boolean },
) => {
  const update = { $set: { licenseNumber: input.licenseNumber, showAsLicensedBroker: input.showAsLicensedBroker } }
  const options = { new: true, runValidators: true }
  if (role === 'agency_owner') {
    return AgencyOwnerProfile.findOneAndUpdate({ userId, organizationId }, update, options)
  }
  return AgentProfile.findOneAndUpdate({ userId, organizationId }, update, options)
}

export const deleteUserCompanionRecords = async (userId: string | Types.ObjectId, session?: ClientSession) => {
  const option = sessionOption(session)
  await Promise.all([
    UserProfile.deleteOne({ userId }, option),
    AgencyOwnerProfile.deleteOne({ userId }, option),
    AgentProfile.deleteOne({ userId }, option),
    SuperAdminProfile.deleteOne({ userId }, option),
  ])
}

export const profileUserIdsMatching = async (organizationId: string | undefined, search: string): Promise<Types.ObjectId[]> => {
  const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const [owners, agents] = await Promise.all([
    AgencyOwnerProfile.find({ ...(organizationId ? { organizationId } : {}), licenseNumber: regex }).select('userId').lean(),
    AgentProfile.find({ ...(organizationId ? { organizationId } : {}), licenseNumber: regex }).select('userId').lean(),
  ])
  return [...new Set([...owners, ...agents].map((row: any) => String(row.userId)))].map((id) => new mongoose.Types.ObjectId(id))
}
