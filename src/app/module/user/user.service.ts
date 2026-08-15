import bcrypt from 'bcryptjs'
import httpStatus from 'http-status'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import hashPassword from '../../helpers/hashPassword'
import paginationHelper from '../../helpers/paginationHelper'
import { Lead } from '../lead/lead.model'
import { Property } from '../property/property.model'
import { Viewing } from '../viewing/viewing.model'
import { IUser, IUserFilter } from './user.interface'
import { User } from './user.model'
import { normalizeBangladeshPhone, normalizeEmail } from '../../helpers/identity'
import { EntitlementService } from '../entitlement/entitlement.service'
import { randomToken } from '../../helpers/crypto'
import { AuthSession } from '../auth/authSession.model'
import { Organization } from '../organization/organization.model'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { effectivePermissionsForUser, normalizeCustomPermissions, permissionCatalog, permissionsForRole } from './accessControl'

const createUser = async (organizationId: string, userData: IUser, actorUserId: string): Promise<IUser> => {
  await EntitlementService.assertLimit(organizationId, 'agents')
  const actor: any = await User.findOne({ _id: actorUserId, organizationId, status: 'active' }).select('userRole accessControl').lean()
  if (!actor) throw new ApiError(httpStatus.FORBIDDEN, 'Creating user is not available')
  const requestedPermissions = userData.accessControl?.useRoleDefaults === false
    ? normalizeCustomPermissions(userData.accessControl.permissions || [])
    : permissionsForRole(userData.userRole || 'agent')
  if (actor.userRole !== 'agency_owner') {
    const actorPermissions = new Set(effectivePermissionsForUser(actor))
    if (requestedPermissions.some((permission) => !actorPermissions.has(permission))) {
      throw new ApiError(httpStatus.FORBIDDEN, 'You cannot grant a role or access level broader than your own')
    }
  }
  userData.organizationId = organizationId
  if (userData.accessControl?.useRoleDefaults === false) {
    userData.accessControl.permissions = normalizeCustomPermissions(userData.accessControl.permissions || [])
  }
  userData.email = normalizeEmail(userData.email)
  try { userData.phoneNumber = normalizeBangladeshPhone(userData.phoneNumber) } catch (error) { throw new ApiError(400, (error as Error).message) }

  const existedEmail = await User.findOne({
    email: userData.email,
  })
  if (existedEmail) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A user with this email already exists in this organization')
  }

  const existedPhone = await User.findOne({
    phoneNumber: userData.phoneNumber,
  })
  if (existedPhone) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A user with this phone number already exists in this organization')
  }

  userData.password = await hashPassword(userData.password || randomToken(24))

  const user = await User.create(userData)
  if (!user) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to create user')
  }

  return user
}

const getAllUsers = async (
  filters: IUserFilter,
  paginationOptions: IPaginationOptions
): Promise<IGenericResponse<IUser[]>> => {
  const { searchTerm, ...filterFields } = filters
  const andConditions: Array<Record<string, unknown>> = []

  if (searchTerm) {
    andConditions.push({
      $or: ['name', 'email', 'phoneNumber', 'licenseNumber'].map((field) => ({
        [field]: { $regex: searchTerm, $options: 'i' },
      })),
    })
  }

  if (Object.keys(filterFields).length) {
    andConditions.push({
      $and: Object.entries(filterFields).map(([key, value]) => ({ [key]: value })),
    })
  }

  const whereCondition = andConditions.length ? { $and: andConditions } : {}
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)

  const result = await User.find(whereCondition)
    .select('-password')
    .sort({ [sortBy]: sortOrder })
    .skip(skip)
    .limit(limit)

  const total = await User.countDocuments(whereCondition)

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: result,
  }
}

const getPublicAgents = async (organizationId: string): Promise<any[]> => {
  const agents = await User.find({
    organizationId,
    userRole: { $in: ['agent', 'agency_admin', 'agency_owner', 'admin', 'staff'] },
  }).select('name email phoneNumber profileImgURL licenseNumber bio specialization')

  const agentsWithStats = await Promise.all(
    agents.map(async (agent) => {
      const activeListings = await Property.countDocuments({
        organizationId,
        agentId: agent._id,
        status: 'Available',
      })
      const closedDeals = await Lead.countDocuments({
        organizationId,
        assignedAgent: agent._id,
        leadStatus: 'Won',
      })

      return {
        _id: agent._id,
        name: agent.name,
        email: agent.email,
        phoneNumber: agent.phoneNumber,
        profileImgURL: agent.profileImgURL,
        licenseNumber: agent.licenseNumber,
        bio: agent.bio,
        specialization: agent.specialization,
        activeListings,
        closedDeals,
      }
    })
  )

  return agentsWithStats
}

const getPublicAgentDetail = async (agentId: string): Promise<any> => {
  const agent = await User.findById(agentId).select(
    'name email phoneNumber profileImgURL licenseNumber bio specialization organizationId'
  )
  if (!agent) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Broker profile not found')
  }

  const activeProperties = await Property.find({
    organizationId: agent.organizationId,
    agentId: agent._id,
    status: 'Available',
  }).select('title price images city propertyType bedrooms bathrooms area areaUnit listingType')

  return {
    agent,
    activeProperties,
  }
}

const getAgentLeaderboard = async (organizationId: string, startDate?: string, endDate?: string): Promise<any[]> => {
  const end = endDate ? new Date(`${endDate}T23:59:59.999+06:00`) : new Date()
  const start = startDate ? new Date(`${startDate}T00:00:00+06:00`) : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000)
  const agents = await User.find({ organizationId, status: 'active', userRole: { $in: ['agent', 'agency_admin', 'agency_owner'] } })
    .select('name email phoneNumber profileImgURL licenseNumber specialization').lean()
  const agentIds = agents.map((agent: any) => agent._id)
  const [leadRows, viewingRows, listingRows] = await Promise.all([
    Lead.aggregate([
      { $match: { organizationId, assignedAgent: { $in: agentIds }, createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$assignedAgent', totalLeads: { $sum: 1 }, dealsWon: { $sum: { $cond: [{ $eq: ['$leadStatus', 'Won'] }, 1, 0] } }, respondedLeads: { $sum: { $cond: [{ $ne: [{ $type: '$firstResponseAt' }, 'missing'] }, 1, 0] } }, slaCompliant: { $sum: { $cond: [{ $and: [{ $ne: [{ $type: '$firstResponseAt' }, 'missing'] }, { $lte: ['$firstResponseAt', '$responseDueAt'] }] }, 1, 0] } }, responseMsTotal: { $sum: { $cond: [{ $and: [{ $ne: [{ $type: '$firstResponseAt' }, 'missing'] }, { $ne: [{ $type: '$createdAt' }, 'missing'] }] }, { $subtract: ['$firstResponseAt', '$createdAt'] }, 0] } } } },
    ]),
    Viewing.aggregate([
      { $match: { organizationId, agentId: { $in: agentIds }, date: { $gte: start.toISOString().slice(0,10), $lte: end.toISOString().slice(0,10) } } },
      { $group: { _id: '$agentId', totalViewings: { $sum: 1 }, completedViewings: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } } } },
    ]),
    Property.aggregate([{ $match: { organizationId, agentId: { $in: agentIds }, status: 'Available' } }, { $group: { _id: '$agentId', activeListings: { $sum: 1 } } }]),
  ])
  const leads = new Map(leadRows.map((row: any) => [String(row._id), row]))
  const viewings = new Map(viewingRows.map((row: any) => [String(row._id), row]))
  const listings = new Map(listingRows.map((row: any) => [String(row._id), row]))
  return agents.map((agent: any) => {
    const l: any = leads.get(String(agent._id)) || {}; const v: any = viewings.get(String(agent._id)) || {}; const p: any = listings.get(String(agent._id)) || {}
    const totalLeads = l.totalLeads || 0, dealsWon = l.dealsWon || 0, responded = l.respondedLeads || 0
    return { agent, totalLeads, dealsWon, totalViewings: v.totalViewings || 0, completedViewings: v.completedViewings || 0, activeListings: p.activeListings || 0,
      conversionRate: totalLeads ? Math.round((dealsWon / totalLeads) * 1000) / 10 : 0,
      responseRate: totalLeads ? Math.round((responded / totalLeads) * 1000) / 10 : 0,
      slaComplianceRate: responded ? Math.round(((l.slaCompliant || 0) / responded) * 1000) / 10 : 0,
      avgFirstResponseMinutes: responded ? Math.round((l.responseMsTotal || 0) / responded / 60000) : null,
      range: { start: start.toISOString(), end: end.toISOString() } }
  }).sort((a: any, b: any) => b.dealsWon - a.dealsWon || b.slaComplianceRate - a.slaComplianceRate || b.totalLeads - a.totalLeads)
}
const getUserById = async (organizationId: string, id: string): Promise<IUser | null> => {
  const result = await User.findOne({ _id: id, organizationId }).select('-password')
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  }
  return result
}

const updateUserById = async (organizationId: string, id: string, userData: Partial<IUser>): Promise<IUser | null> => {
  const { password: _password, organizationId: _org, userRole: _role, isVerified: _verified, ...safeData } = userData
  const result = await User.findOneAndUpdate({ _id: id, organizationId }, safeData, { new: true }).select('-password')
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  }
  return result
}

const deleteUserById = async (organizationId: string, id: string): Promise<IUser | null> => {
  const result = await User.findOneAndDelete({ _id: id, organizationId, userRole: { $ne: 'agency_owner' } })
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  }
  return result
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
    User.find(whereConditions).select('-password').sort(sortConditions).skip(skip).limit(limit).lean(),
    User.countDocuments(whereConditions),
  ])
  return { meta: { page, limit, total }, data: result }
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
  const user: any = await User.findById(id)
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found')

  const { reason, ...changes } = payload
  const resultingRole = changes.userRole ?? user.userRole
  const resultingStatus = changes.status ?? user.status
  if (user.userRole === 'super-admin' && user.status === 'active' && (resultingRole !== 'super-admin' || resultingStatus !== 'active')) {
    const activePlatformAdmins = await User.countDocuments({ userRole: 'super-admin', status: 'active' })
    if (activePlatformAdmins <= 1) throw new ApiError(httpStatus.CONFLICT, 'At least one active super administrator must remain')
  }

  const result = await User.findByIdAndUpdate(id, changes, { new: true, runValidators: true }).select('-password')
  if (changes.status === 'blocked') {
    await AuthSession.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: 'platform_user_suspended' } })
    if (user.userRole === 'agency_owner') {
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
  if (changes.status === 'active' && user.userRole === 'agency_owner') {
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
  return result
}


const getMyAccess = async (organizationId: string, userId: string) => {
  const user: any = await User.findOne({ _id: userId, organizationId }).select('_id name userRole accessControl').lean()
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  return {
    userId: String(user._id),
    userRole: user.userRole,
    useRoleDefaults: user.userRole === 'agency_owner' ? true : user.accessControl?.useRoleDefaults !== false,
    permissions: effectivePermissionsForUser(user),
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
  const target: any = await User.findOne({ _id: targetUserId, organizationId })
  if (!target) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found')
  if (target.userRole === 'agency_owner') throw new ApiError(httpStatus.FORBIDDEN, 'Agency owner access cannot be restricted')

  const role = payload.userRole || target.userRole
  const allowedRoles = new Set(['agency_admin', 'agent', 'staff', 'viewer'])
  if (!allowedRoles.has(role)) throw new ApiError(httpStatus.BAD_REQUEST, 'Unsupported team role')
  const permissions = normalizeCustomPermissions(payload.permissions || [])

  target.userRole = role
  target.accessControl = { useRoleDefaults: payload.useRoleDefaults, permissions: payload.useRoleDefaults ? [] : permissions }
  await target.save()
  await CacheInvalidationService.invalidateTenant(organizationId)

  const result = target.toObject()
  delete result.password
  return { ...result, permissions: effectivePermissionsForUser(target) }
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
