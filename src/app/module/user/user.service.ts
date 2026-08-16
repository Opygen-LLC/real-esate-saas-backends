import httpStatus from 'http-status'
import mongoose from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import hashPassword from '../../helpers/hashPassword'
import paginationHelper from '../../helpers/paginationHelper'
import { normalizeBangladeshPhone, normalizeEmail } from '../../helpers/identity'
import { randomToken } from '../../helpers/crypto'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { AccountCredential } from '../accountCredential/accountCredential.model'
import { AuthSession } from '../auth/authSession.model'
import { OtpChallenge } from '../auth/otpChallenge.model'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Lead } from '../lead/lead.model'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { Viewing } from '../viewing/viewing.model'
import { UserProfile } from '../userProfile/userProfile.model'
import { effectivePermissionsForUser, normalizeCustomPermissions, permissionCatalog, permissionsForRole } from './accessControl'
import { UserResponseDto } from './user.dto'
import { IUserCreateInput, IUserFilter, IUserRole, IUserUpdateInput } from './user.interface'
import { User } from './user.model'
import {
  deleteUserCompanionRecords,
  ensureUserProfile,
  getRoleProfileFields,
  getUserAccessControl,
  populateUserProfiles,
  profileUserIdsMatching,
  syncRoleProfile,
  toPublicAgentDto,
  toUserDto,
  updateUserProfileFields,
  USER_PROFILE_POPULATES,
} from './userProfile.service'

const createUser = async (organizationId: string, userData: IUserCreateInput, actorUserId: string): Promise<UserResponseDto> => {
  await EntitlementService.assertLimit(organizationId, 'agents')
  const actor = await User.findOne({ _id: actorUserId, organizationId, status: 'active' }).select('_id userRole')
  if (!actor) throw new ApiError(httpStatus.FORBIDDEN, 'Creating user is not available')
  const actorAccess = await getUserAccessControl(actor._id)
  const requestedAccess = userData.accessControl || { useRoleDefaults: true, permissions: [] }
  const requestedPermissions = requestedAccess.useRoleDefaults === false
    ? normalizeCustomPermissions(requestedAccess.permissions || [])
    : permissionsForRole(userData.userRole || 'agent')
  if (actor.userRole !== 'agency_owner') {
    const actorPermissions = new Set(effectivePermissionsForUser({ userRole: actor.userRole, accessControl: actorAccess }))
    if (requestedPermissions.some((permission) => !actorPermissions.has(permission))) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You cannot grant a role or access level broader than your own')
    }
  }

  const email = normalizeEmail(userData.email)
  let phoneNumber: string
  try { phoneNumber = normalizeBangladeshPhone(userData.phoneNumber) } catch (error) { throw new ApiError(400, (error as Error).message) }
  if (await User.exists({ email })) throw new ApiError(httpStatus.CONFLICT, 'A user with this email already exists')
  if (await User.exists({ phoneNumber })) throw new ApiError(httpStatus.CONFLICT, 'A user with this phone number already exists')

  const passwordHash = await hashPassword(userData.password || randomToken(24))
  const userId = new mongoose.Types.ObjectId()
  const role = (userData.userRole || 'agent') as IUserRole
  const provision = async (session?: mongoose.ClientSession) => {
    const sessionOptions = session ? { session } : undefined
    await User.create([{
      _id: userId,
      name: userData.name,
      email,
      phoneNumber,
      organizationId,
      userRole: role,
      status: userData.status || 'pending',
      isVerified: Boolean(userData.isVerified),
    }], sessionOptions)
    await AccountCredential.create([{
      userId,
      passwordHash,
      passwordChangedAt: new Date(),
      emailVerifiedAt: userData.isVerified ? new Date() : null,
    }], sessionOptions)
    await ensureUserProfile(userId, {
      profileImgURL: userData.profileImgURL,
      bio: userData.bio,
      address: userData.address,
      gender: userData.gender,
      isAddProfile: userData.isAddProfile,
      sidebar_permission: userData.sidebar_permission,
      accessControl: {
        useRoleDefaults: requestedAccess.useRoleDefaults !== false,
        permissions: requestedAccess.useRoleDefaults === false ? normalizeCustomPermissions(requestedAccess.permissions || []) : [],
      },
    }, session)
    await syncRoleProfile(userId, organizationId, role, {
      licenseNumber: userData.licenseNumber,
      specialization: userData.specialization,
      serviceAreas: userData.serviceAreas,
    }, session)
  }

  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try { await session.withTransaction(() => provision(session)) } finally { await session.endSession() }
  } else await provision()

  const user = await User.findById(userId)
  if (!user) throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to create user')
  await populateUserProfiles(user)
  return toUserDto(user, { includeAccessControl: true, includePrivateProfile: true, includePermissions: true })
}

const buildUserWhere = async (filters: IUserFilter) => {
  const { searchTerm, ...filterFields } = filters
  const andConditions: Array<Record<string, unknown>> = []
  if (searchTerm) {
    const escaped = String(searchTerm).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const profileIds = await profileUserIdsMatching(filters.organizationId, escaped)
    andConditions.push({
      $or: [
        ...['name', 'email', 'phoneNumber'].map((field) => ({ [field]: { $regex: escaped, $options: 'i' } })),
        ...(profileIds.length ? [{ _id: { $in: profileIds } }] : []),
      ],
    })
  }
  if (Object.keys(filterFields).length) {
    andConditions.push({ $and: Object.entries(filterFields).map(([key, value]) => ({ [key]: value })) })
  }
  return andConditions.length ? { $and: andConditions } : {}
}

const getAllUsers = async (
  filters: IUserFilter,
  paginationOptions: IPaginationOptions,
): Promise<IGenericResponse<UserResponseDto[]>> => {
  const whereCondition = await buildUserWhere(filters)
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)
  const [result, total] = await Promise.all([
    User.find(whereCondition).populate(USER_PROFILE_POPULATES).sort({ [sortBy]: sortOrder }).skip(skip).limit(limit),
    User.countDocuments(whereCondition),
  ])
  return {
    meta: { page, limit, total },
    data: result.map((user) => toUserDto(user, { includeAccessControl: true, includePrivateProfile: true, includePermissions: true })),
  }
}

const getPublicAgents = async (organizationId: string): Promise<any[]> => {
  const agents = await User.find({
    organizationId,
    status: 'active',
    userRole: { $in: ['agent', 'agency_admin', 'agency_owner', 'staff'] },
  }).populate(USER_PROFILE_POPULATES)
  const agentIds = agents.map((agent) => agent._id)
  const [listingRows, dealRows] = await Promise.all([
    Property.aggregate([
      { $match: { organizationId, agentId: { $in: agentIds }, status: 'Available' } },
      { $group: { _id: '$agentId', count: { $sum: 1 } } },
    ]),
    Lead.aggregate([
      { $match: { organizationId, assignedAgent: { $in: agentIds }, leadStatus: 'Won' } },
      { $group: { _id: '$assignedAgent', count: { $sum: 1 } } },
    ]),
  ])
  const listings = new Map(listingRows.map((row: any) => [String(row._id), Number(row.count || 0)]))
  const deals = new Map(dealRows.map((row: any) => [String(row._id), Number(row.count || 0)]))
  return agents.map((agent) => ({
    ...toPublicAgentDto(agent),
    activeListings: listings.get(String(agent._id)) || 0,
    closedDeals: deals.get(String(agent._id)) || 0,
  }))
}

const getPublicAgentDetail = async (agentId: string): Promise<any> => {
  const agent = await User.findOne({ _id: agentId, status: 'active', userRole: { $in: ['agency_owner', 'agency_admin', 'agent', 'staff'] } })
    .populate(USER_PROFILE_POPULATES)
  if (!agent) throw new ApiError(httpStatus.NOT_FOUND, 'Broker profile not found')
  const activeProperties = await Property.find({
    organizationId: agent.organizationId,
    agentId: agent._id,
    status: 'Available',
  }).select('title price images city propertyType bedrooms bathrooms area areaUnit listingType')
  return { agent: toPublicAgentDto(agent), activeProperties }
}

const getAgentLeaderboard = async (organizationId: string, startDate?: string, endDate?: string): Promise<any[]> => {
  const end = endDate ? new Date(`${endDate}T23:59:59.999+06:00`) : new Date()
  const start = startDate ? new Date(`${startDate}T00:00:00+06:00`) : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000)
  const agents = await User.find({ organizationId, status: 'active', userRole: { $in: ['agent', 'agency_admin', 'agency_owner'] } })
    .populate(USER_PROFILE_POPULATES)
  const agentIds = agents.map((agent) => agent._id)
  const [leadRows, viewingRows, listingRows] = await Promise.all([
    Lead.aggregate([
      { $match: { organizationId, assignedAgent: { $in: agentIds }, createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$assignedAgent', totalLeads: { $sum: 1 }, dealsWon: { $sum: { $cond: [{ $eq: ['$leadStatus', 'Won'] }, 1, 0] } }, respondedLeads: { $sum: { $cond: [{ $ne: [{ $type: '$firstResponseAt' }, 'missing'] }, 1, 0] } }, slaCompliant: { $sum: { $cond: [{ $and: [{ $ne: [{ $type: '$firstResponseAt' }, 'missing'] }, { $lte: ['$firstResponseAt', '$responseDueAt'] }] }, 1, 0] } }, responseMsTotal: { $sum: { $cond: [{ $and: [{ $ne: [{ $type: '$firstResponseAt' }, 'missing'] }, { $ne: [{ $type: '$createdAt' }, 'missing'] }] }, { $subtract: ['$firstResponseAt', '$createdAt'] }, 0] } } } },
    ]),
    Viewing.aggregate([
      { $match: { organizationId, agentId: { $in: agentIds }, date: { $gte: start.toISOString().slice(0, 10), $lte: end.toISOString().slice(0, 10) } } },
      { $group: { _id: '$agentId', totalViewings: { $sum: 1 }, completedViewings: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } } } },
    ]),
    Property.aggregate([{ $match: { organizationId, agentId: { $in: agentIds }, status: 'Available' } }, { $group: { _id: '$agentId', activeListings: { $sum: 1 } } }]),
  ])
  const leads = new Map(leadRows.map((row: any) => [String(row._id), row]))
  const viewings = new Map(viewingRows.map((row: any) => [String(row._id), row]))
  const listings = new Map(listingRows.map((row: any) => [String(row._id), row]))
  return agents.map((agent) => {
    const l: any = leads.get(String(agent._id)) || {}
    const v: any = viewings.get(String(agent._id)) || {}
    const p: any = listings.get(String(agent._id)) || {}
    const totalLeads = l.totalLeads || 0
    const dealsWon = l.dealsWon || 0
    const responded = l.respondedLeads || 0
    return {
      agent: toPublicAgentDto(agent), totalLeads, dealsWon, totalViewings: v.totalViewings || 0,
      completedViewings: v.completedViewings || 0, activeListings: p.activeListings || 0,
      conversionRate: totalLeads ? Math.round((dealsWon / totalLeads) * 1000) / 10 : 0,
      responseRate: totalLeads ? Math.round((responded / totalLeads) * 1000) / 10 : 0,
      slaComplianceRate: responded ? Math.round(((l.slaCompliant || 0) / responded) * 1000) / 10 : 0,
      avgFirstResponseMinutes: responded ? Math.round((l.responseMsTotal || 0) / responded / 60000) : null,
      range: { start: start.toISOString(), end: end.toISOString() },
    }
  }).sort((a: any, b: any) => b.dealsWon - a.dealsWon || b.slaComplianceRate - a.slaComplianceRate || b.totalLeads - a.totalLeads)
}

const getUserById = async (organizationId: string, id: string) => {
  const result = await User.findOne({ _id: id, organizationId }).populate(USER_PROFILE_POPULATES)
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  return toUserDto(result, { includeAccessControl: true, includePrivateProfile: true, includePermissions: true })
}

const updateUserById = async (organizationId: string, id: string, userData: IUserUpdateInput) => {
  const user = await User.findOne({ _id: id, organizationId })
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  if (userData.name !== undefined) user.name = userData.name
  await user.save()
  await updateUserProfileFields(user._id, userData)
  const currentRoleFields = await getRoleProfileFields(user._id)
  await syncRoleProfile(user._id, organizationId, user.userRole, {
    licenseNumber: userData.licenseNumber ?? currentRoleFields.licenseNumber,
    specialization: userData.specialization ?? currentRoleFields.specialization,
    serviceAreas: userData.serviceAreas ?? currentRoleFields.serviceAreas,
  })
  await populateUserProfiles(user)
  await CacheInvalidationService.invalidateTenant(organizationId)
  return toUserDto(user, { includeAccessControl: true, includePrivateProfile: true, includePermissions: true })
}

const deleteUserById = async (organizationId: string, id: string) => {
  const user = await User.findOne({ _id: id, organizationId, userRole: { $ne: 'agency_owner' } }).populate(USER_PROFILE_POPULATES)
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  const dto = toUserDto(user, { includeAccessControl: true, includePrivateProfile: true })
  const remove = async (session?: mongoose.ClientSession) => {
    await Promise.all([
      AccountCredential.deleteOne({ userId: user._id }, session ? { session } : undefined),
      AuthSession.deleteMany({ userId: user._id }, session ? { session } : undefined),
      OtpChallenge.deleteMany({ userId: user._id }, session ? { session } : undefined),
      deleteUserCompanionRecords(user._id, session),
    ])
    await User.deleteOne({ _id: user._id, organizationId }, session ? { session } : undefined)
  }
  if (await mongoSupportsTransactions()) {
    const session = await mongoose.startSession()
    try { await session.withTransaction(() => remove(session)) } finally { await session.endSession() }
  } else await remove()
  await CacheInvalidationService.invalidateTenant(organizationId)
  return dto
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const superAdminUserWhere = (filters: IUserFilter) => {
  const { searchTerm, userRole, status, ...filtersData } = filters
  const andConditions: any[] = []
  if (searchTerm) {
    const search = escapeRegex(String(searchTerm).trim())
    andConditions.push({ $or: ['name', 'email', 'phoneNumber', 'organizationId'].map((field) => ({ [field]: { $regex: search, $options: 'i' } })) })
  }
  if (userRole) andConditions.push({ userRole })
  if (status) andConditions.push({ status })
  if (Object.keys(filtersData).length) andConditions.push({ $and: Object.entries(filtersData).map(([field, value]) => ({ [field]: value })) })
  return andConditions.length ? { $and: andConditions } : {}
}

const getAllUsersSuperAdmin = async (filters: IUserFilter, paginationOptions: IPaginationOptions) => {
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination({ ...paginationOptions, limit: paginationOptions.limit || 10 })
  const whereConditions = superAdminUserWhere(filters)
  const sortConditions: Record<string, any> = sortBy ? { [sortBy]: sortOrder, ...(sortBy === 'createdAt' ? { _id: sortOrder } : {}) } : { createdAt: -1, _id: -1 }
  const [result, total] = await Promise.all([
    User.find(whereConditions).populate(USER_PROFILE_POPULATES).sort(sortConditions).skip(skip).limit(limit),
    User.countDocuments(whereConditions),
  ])
  return { meta: { page, limit, total }, data: result.map((user) => toUserDto(user, { includeAccessControl: true, includePrivateProfile: true })) }
}

const getSuperAdminUserSummary = async () => {
  const [total, active, blocked, roles] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ status: 'active' }),
    User.countDocuments({ status: 'blocked' }),
    User.aggregate([{ $group: { _id: '$userRole', count: { $sum: 1 } } }]),
  ])
  return { total, active, blocked, roles: Object.fromEntries(roles.map((row: any) => [String(row._id || 'unknown'), Number(row.count || 0)])) }
}

const getAllUsersSuperAdminExportCursor = (filters: IUserFilter) =>
  User.find(superAdminUserWhere(filters)).select('name email phoneNumber userRole organizationId status createdAt').sort({ createdAt: -1, _id: -1 }).lean().cursor()

const updateUserRoleSuperAdmin = async (id: string, payload: { userRole?: string; status?: string; reason: string }, actorId?: string) => {
  const user = await User.findById(id)
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  const { reason, ...changes } = payload
  const resultingRole = (changes.userRole ?? user.userRole) as IUserRole
  const resultingStatus = (changes.status ?? user.status) as 'pending' | 'active' | 'blocked'
  if (user.userRole === 'super-admin' && user.status === 'active' && (resultingRole !== 'super-admin' || resultingStatus !== 'active')) {
    const activePlatformAdmins = await User.countDocuments({ userRole: 'super-admin', status: 'active' })
    if (activePlatformAdmins <= 1) throw new ApiError(httpStatus.CONFLICT, 'At least one active super administrator must remain')
  }
  if (user.userRole === 'agency_owner' && resultingRole !== 'agency_owner') {
    const ownedOrganization = await Organization.exists({ ownerId: user._id })
    if (ownedOrganization) throw new ApiError(httpStatus.CONFLICT, 'Transfer agency ownership before changing the owner role')
  }
  if (resultingRole === 'agency_owner' && user.userRole !== 'agency_owner') {
    const organization = await Organization.findOne({ organizationId: user.organizationId }).select('ownerId').lean()
    if (!organization || String(organization.ownerId || '') !== String(user._id)) {
      throw new ApiError(httpStatus.CONFLICT, 'Use the agency ownership transfer flow before assigning the agency owner role')
    }
  }

  const previousRole = user.userRole
  const roleFields = await getRoleProfileFields(user._id)
  user.userRole = resultingRole
  user.status = resultingStatus
  await user.save()
  if (resultingRole !== previousRole) await syncRoleProfile(user._id, user.organizationId, resultingRole, roleFields)

  if (changes.status === 'blocked') {
    await AuthSession.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: 'platform_user_suspended' } })
    if (previousRole === 'agency_owner') {
      const org: any = await Organization.findOne({ organizationId: user.organizationId })
      if (org && !org.isBlocked) {
        const previousSubscriptionStatus = org.subscription?.status || 'active'
        const previousWebsiteStatus = org.websiteStatus || 'published'
        org.isBlocked = true
        org.websiteStatus = 'suspended'
        if (org.subscription) org.subscription.status = 'suspended'
        org.platformAccess = {
          ...(org.platformAccess?.toObject?.() || org.platformAccess || {}), status: 'suspended', suspendedAt: new Date(), suspendedBy: actorId || '',
          suspensionReason: reason, previousSubscriptionStatus, previousWebsiteStatus, suspensionSource: 'owner_user', suspensionUserId: String(user._id),
        }
        await org.save()
        await Promise.all([
          AuthSession.updateMany({ organizationId: user.organizationId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: 'tenant_owner_suspended' } }),
          CacheInvalidationService.invalidateTenant(user.organizationId),
        ])
      }
    }
  }
  if (changes.status === 'active' && previousRole === 'agency_owner') {
    const org: any = await Organization.findOne({ organizationId: user.organizationId })
    if (org?.isBlocked && org.platformAccess?.suspensionSource === 'owner_user' && String(org.platformAccess?.suspensionUserId || '') === String(user._id)) {
      const restoredSubscription = org.platformAccess?.previousSubscriptionStatus && org.platformAccess.previousSubscriptionStatus !== 'suspended' ? org.platformAccess.previousSubscriptionStatus : (org.subscription?.plan === 'trial' ? 'trialing' : 'active')
      const restoredWebsite = org.platformAccess?.previousWebsiteStatus && org.platformAccess.previousWebsiteStatus !== 'suspended' ? org.platformAccess.previousWebsiteStatus : 'published'
      org.isBlocked = false
      org.websiteStatus = restoredWebsite
      if (org.subscription) org.subscription.status = restoredSubscription
      org.platformAccess = { ...(org.platformAccess?.toObject?.() || org.platformAccess || {}), status: 'active', reactivatedAt: new Date(), reactivatedBy: actorId || '', reactivationReason: reason, suspensionSource: null, suspensionUserId: null }
      await org.save()
      await CacheInvalidationService.invalidateTenant(user.organizationId)
    }
  }
  await populateUserProfiles(user)
  return toUserDto(user, { includeAccessControl: true, includePrivateProfile: true })
}

const getMyAccess = async (organizationId: string, userId: string) => {
  const user = await User.findOne({ _id: userId, organizationId }).select('_id name userRole')
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  const accessControl = await getUserAccessControl(user._id)
  return {
    userId: String(user._id),
    userRole: user.userRole,
    useRoleDefaults: user.userRole === 'agency_owner' ? true : accessControl.useRoleDefaults !== false,
    permissions: effectivePermissionsForUser({ userRole: user.userRole, accessControl }),
    roleDefaults: permissionsForRole(user.userRole),
    catalog: permissionCatalog,
  }
}

const updateMemberAccess = async (
  organizationId: string,
  actorUserId: string,
  targetUserId: string,
  payload: { userRole?: 'agency_admin' | 'agent' | 'staff' | 'viewer'; useRoleDefaults: boolean; permissions?: string[] },
) => {
  if (String(actorUserId) === String(targetUserId)) throw new ApiError(httpStatus.BAD_REQUEST, 'You cannot change your own access policy')
  const target = await User.findOne({ _id: targetUserId, organizationId })
  if (!target) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found')
  if (target.userRole === 'agency_owner') throw new ApiError(httpStatus.FORBIDDEN, 'Agency owner access cannot be restricted')
  const role = (payload.userRole || target.userRole) as IUserRole
  const allowedRoles = new Set(['agency_admin', 'agent', 'staff', 'viewer'])
  if (!allowedRoles.has(role)) throw new ApiError(httpStatus.BAD_REQUEST, 'Unsupported team role')
  const permissions = normalizeCustomPermissions(payload.permissions || [])
  const roleFields = await getRoleProfileFields(target._id)
  target.userRole = role
  await target.save()
  await updateUserProfileFields(target._id, {
    accessControl: { useRoleDefaults: payload.useRoleDefaults, permissions: payload.useRoleDefaults ? [] : permissions },
  })
  await syncRoleProfile(target._id, organizationId, role, roleFields)
  await CacheInvalidationService.invalidateTenant(organizationId)
  await populateUserProfiles(target)
  return toUserDto(target, { includeAccessControl: true, includePrivateProfile: true, includePermissions: true })
}

export const UserService = {
  createUser,
  getAllUsers,
  getPublicAgents,
  getPublicAgentDetail,
  getAgentLeaderboard,
  getUserById,
  updateUserById,
  deleteUserById,
  getAllUsersSuperAdmin,
  getSuperAdminUserSummary,
  getAllUsersSuperAdminExportCursor,
  updateUserRoleSuperAdmin,
  getMyAccess,
  updateMemberAccess,
}
