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
import { RealtimeService } from '../realtime/realtime.service'
import { EntitlementService, TEAM_MEMBER_SEAT_ROLES } from '../entitlement/entitlement.service'
import { Lead } from '../lead/lead.model'
import { convertedStatusExpression } from '../lead/leadStatus.contract'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { Viewing } from '../viewing/viewing.model'
import { AgencyOwnerProfile } from '../agencyOwnerProfile/agencyOwnerProfile.model'
import { AgentProfile } from '../agentProfile/agentProfile.model'
import { effectivePermissionsForUser, normalizeCustomPermissions, permissionCatalog, permissionsForRole } from './accessControl'
import { UserResponseDto } from './user.dto'
import { IUserCreateInput, IUserFilter, IUserRole, IUserUpdateInput } from './user.interface'
import { User } from './user.model'
import {
  deleteUserCompanionRecords,
  ensureUserProfile,
  getRoleProfileFields,
  getUserAccessControl,
  syncRoleProfile,
  toPublicAgentDto,
  toUserDto,
  updateLicensedBrokerProfile,
  updateUserProfileFields,
} from './userProfile.service'
import { asUserObjectId, findUserWithProfiles, listUsersWithProfiles, paginateUsersWithProfiles, userProfileProjectionStages } from './userReadModel.service'


const markSessionAuthorizationChanged = async (
  userId: mongoose.Types.ObjectId | string,
  organizationId?: string,
  reason = 'authorization_changed',
  forceLogout = false,
) => {
  const changedAt = new Date()
  await AuthSession.updateMany(
    { userId, revokedAt: null, expiresAt: { $gt: changedAt } },
    { $set: { authorizationChangedAt: changedAt }, $inc: { authorizationVersion: 1 } },
  )
  RealtimeService.emitAuthorizationChanged({ userId: String(userId), organizationId, forceLogout, reason })
}

const createUser = async (organizationId: string, userData: IUserCreateInput, actorUserId: string): Promise<UserResponseDto> => {
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
      showAsLicensedBroker: userData.showAsLicensedBroker,
      specialization: userData.specialization,
      serviceAreas: userData.serviceAreas,
    }, session)
  }

  await EntitlementService.withTeamMemberQuotaGuard(organizationId, async (session) => {
    await EntitlementService.assertTeamMemberCapacity(organizationId, { additionalCommitments: 1, session })
    await provision(session)
  })

  const user = await findUserWithProfiles({ _id: userId })
  if (!user) throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to create user')
  RealtimeService.emitOrganization(organizationId, { type: 'team.changed', action: 'created', entityId: user._id.toString() })
  return toUserDto(user, { includeAccessControl: true, includePrivateProfile: true, includePermissions: true })
}

const USER_LIST_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'name', 'email', 'userRole', 'status'])

const buildUserWhere = (filters: IUserFilter) => {
  const { searchTerm: _searchTerm, ...filterFields } = filters
  const entries = Object.entries(filterFields).filter(([, value]) => value !== undefined && value !== null && value !== '')
  return entries.length ? { $and: entries.map(([key, value]) => ({ [key]: value })) } : {}
}

const getAllUsers = async (
  filters: IUserFilter,
  paginationOptions: IPaginationOptions,
): Promise<IGenericResponse<UserResponseDto[]>> => {
  const whereCondition = buildUserWhere(filters)
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)
  const { rows, total } = await paginateUsersWithProfiles({
    match: whereCondition,
    searchTerm: filters.searchTerm,
    sort: paginationHelper.buildAllowedStableSort(sortBy, sortOrder, USER_LIST_SORT_FIELDS, 'createdAt'),
    skip,
    limit,
  })
  return {
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) } as any,
    data: rows.map((user) => toUserDto(user, { includeAccessControl: true, includePrivateProfile: true, includePermissions: true })),
  }
}

const getTeamRoleSummary = async (organizationId: string) => {
  const grouped = await User.aggregate<{ _id: IUserRole; activeCount: number }>([
    {
      $match: {
        organizationId,
        status: 'active',
        userRole: { $in: [...TEAM_MEMBER_SEAT_ROLES] },
      },
    },
    { $group: { _id: '$userRole', activeCount: { $sum: 1 } } },
  ])

  const counts = new Map<IUserRole, number>(
    grouped.map((item) => [item._id, Number(item.activeCount || 0)]),
  )

  const roles = TEAM_MEMBER_SEAT_ROLES
    .map((role) => ({ role, activeCount: counts.get(role) || 0 }))
    .filter((item) => item.activeCount > 0)

  return {
    totalActive: roles.reduce((total, item) => total + item.activeCount, 0),
    roles,
  }
}

const PUBLIC_BROKER_MEMBER_ROLES: IUserRole[] = ['agency_owner', 'agency_admin', 'agent', 'staff', 'viewer']
const LICENSE_PRESENT = /\S/

const publicBrokerVisibilityStage = {
  $match: {
    $or: [
      {
        userRole: 'agency_owner',
        'agencyOwnerProfile.showAsLicensedBroker': true,
        'agencyOwnerProfile.licenseNumber': LICENSE_PRESENT,
      },
      {
        userRole: { $in: ['agency_admin', 'agent', 'staff', 'viewer'] },
        'agentProfile.showAsLicensedBroker': true,
        'agentProfile.licenseNumber': LICENSE_PRESENT,
      },
    ],
  },
}

const getPublicAgents = async (organizationId: string): Promise<any[]> => {
  const agents = await User.aggregate([
    {
      $match: {
        organizationId,
        status: 'active',
        userRole: { $in: PUBLIC_BROKER_MEMBER_ROLES },
      },
    },
    ...userProfileProjectionStages(),
    publicBrokerVisibilityStage,
    {
      $lookup: {
        from: Property.collection.name,
        let: { agentId: '$_id', tenantId: '$organizationId' },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ['$agentId', '$$agentId'] },
            { $eq: ['$organizationId', '$$tenantId'] },
            { $eq: ['$status', 'Available'] },
          ] } } },
          { $count: 'count' },
        ],
        as: '_listingStats',
      },
    },
    {
      $lookup: {
        from: Lead.collection.name,
        let: { agentId: '$_id', tenantId: '$organizationId' },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ['$assignedAgent', '$$agentId'] },
            { $eq: ['$organizationId', '$$tenantId'] },
            convertedStatusExpression(),
          ] } } },
          { $count: 'count' },
        ],
        as: '_dealStats',
      },
    },
    {
      $set: {
        activeListings: { $ifNull: [{ $arrayElemAt: ['$_listingStats.count', 0] }, 0] },
        closedDeals: { $ifNull: [{ $arrayElemAt: ['$_dealStats.count', 0] }, 0] },
      },
    },
    { $unset: ['_listingStats', '_dealStats'] },
    { $sort: { name: 1, _id: 1 } },
  ])

  return agents.map((agent) => ({
    ...toPublicAgentDto(agent),
    activeListings: Number(agent.activeListings || 0),
    closedDeals: Number(agent.closedDeals || 0),
  }))
}

const getPublicAgentDetail = async (agentId: string): Promise<any> => {
  const objectId = asUserObjectId(agentId)
  if (!objectId) throw new ApiError(httpStatus.NOT_FOUND, 'Broker profile not found')

  const [row] = await User.aggregate([
    { $match: { _id: objectId, status: 'active', userRole: { $in: PUBLIC_BROKER_MEMBER_ROLES } } },
    ...userProfileProjectionStages(),
    publicBrokerVisibilityStage,
    {
      $lookup: {
        from: Property.collection.name,
        let: { agentId: '$_id', tenantId: '$organizationId' },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ['$agentId', '$$agentId'] },
            { $eq: ['$organizationId', '$$tenantId'] },
            { $eq: ['$status', 'Available'] },
          ] } } },
          { $project: { title: 1, price: 1, images: 1, city: 1, propertyType: 1, bedrooms: 1, bathrooms: 1, area: 1, areaUnit: 1, listingType: 1 } },
          { $sort: { updatedAt: -1, _id: -1 } },
        ],
        as: 'activeProperties',
      },
    },
    { $limit: 1 },
  ])
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Broker profile not found')
  return { agent: toPublicAgentDto(row), activeProperties: row.activeProperties || [] }
}

const updatePublicBrokerProfile = async (
  organizationId: string,
  actorUserId: string,
  targetUserId: string,
  payload: { showAsLicensedBroker: boolean; licenseNumber?: string },
): Promise<UserResponseDto> => {
  const objectId = asUserObjectId(targetUserId)
  if (!objectId) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found')

  const [actor, target] = await Promise.all([
    User.findOne({ _id: actorUserId, organizationId, status: 'active' }).select('_id userRole').lean(),
    User.findOne({ _id: objectId, organizationId }).select('_id organizationId userRole status').lean(),
  ])
  if (!actor) throw new ApiError(httpStatus.FORBIDDEN, 'Managing public broker profiles is not available')
  if (!target) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found')
  if (!PUBLIC_BROKER_MEMBER_ROLES.includes(target.userRole)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This team role cannot have a public broker profile')
  }
  if (target.userRole === 'agency_owner' && String(actor._id) !== String(target._id)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only the agency owner can change the owner public broker profile')
  }
  if (payload.showAsLicensedBroker && target.status !== 'active') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Only active team members can be shown as licensed brokers')
  }

  const existingProfile = target.userRole === 'agency_owner'
    ? await AgencyOwnerProfile.findOne({ userId: target._id, organizationId }).select('licenseNumber showAsLicensedBroker').lean()
    : await AgentProfile.findOne({ userId: target._id, organizationId }).select('licenseNumber showAsLicensedBroker').lean()
  if (!existingProfile) throw new ApiError(httpStatus.CONFLICT, 'Team member role profile is missing')

  const licenseNumber = payload.licenseNumber !== undefined
    ? payload.licenseNumber.trim()
    : String(existingProfile.licenseNumber || '').trim()
  if (payload.showAsLicensedBroker && !licenseNumber) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A license number is required before publishing this broker profile')
  }

  await updateLicensedBrokerProfile(target._id, organizationId, target.userRole, {
    licenseNumber,
    showAsLicensedBroker: payload.showAsLicensedBroker,
  })
  await CacheInvalidationService.invalidateTenant(organizationId)

  const readModel = await findUserWithProfiles({ _id: target._id, organizationId })
  if (!readModel) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found')

  const event = { type: 'team.changed' as const, action: 'updated', entityId: String(target._id) }
  RealtimeService.emitOrganization(organizationId, event)
  RealtimeService.emitPublicOrganization(organizationId, event)
  return toUserDto(readModel, { includeAccessControl: true, includePrivateProfile: true, includePermissions: true })
}

const getAgentLeaderboard = async (organizationId: string, startDate?: string, endDate?: string, paginationOptions: IPaginationOptions = {}): Promise<IGenericResponse<any[]>> => {
  const end = endDate ? new Date(`${endDate}T23:59:59.999+06:00`) : new Date()
  const start = startDate ? new Date(`${startDate}T00:00:00+06:00`) : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000)
  const agents = await listUsersWithProfiles({ organizationId, status: 'active', userRole: { $in: ['agent', 'agency_admin', 'agency_owner'] } })
  const agentIds = agents.map((agent) => agent._id)
  const [leadRows, viewingRows, listingRows] = await Promise.all([
    Lead.aggregate([
      { $match: { organizationId, assignedAgent: { $in: agentIds }, createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$assignedAgent', totalLeads: { $sum: 1 }, dealsWon: { $sum: { $cond: [convertedStatusExpression(), 1, 0] } }, respondedLeads: { $sum: { $cond: [{ $ne: [{ $type: '$firstResponseAt' }, 'missing'] }, 1, 0] } }, slaCompliant: { $sum: { $cond: [{ $and: [{ $ne: [{ $type: '$firstResponseAt' }, 'missing'] }, { $lte: ['$firstResponseAt', '$responseDueAt'] }] }, 1, 0] } }, responseMsTotal: { $sum: { $cond: [{ $and: [{ $ne: [{ $type: '$firstResponseAt' }, 'missing'] }, { $ne: [{ $type: '$createdAt' }, 'missing'] }] }, { $subtract: ['$firstResponseAt', '$createdAt'] }, 0] } } } },
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
  const ranked = agents.map((agent) => {
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
  const { page, limit, skip } = paginationHelper.calculatePagination(paginationOptions)
  return { data: ranked.slice(skip, skip + limit), meta: { page, limit, total: ranked.length, totalPages: Math.ceil(ranked.length / limit) } as any }
}

const exportTeamMembersCsv = async (organizationId: string, filters: IUserFilter) => {
  const whereCondition = buildUserWhere({ ...filters, organizationId })
  const rows = await listUsersWithProfiles(whereCondition, { sort: { createdAt: -1, _id: -1 } })
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const header = ['ID','Name','Email','Phone','Role','Status'].join(',')
  const body = rows.map((user: any) => [user._id, user.name, user.email, user.phoneNumber, user.userRole, user.status].map(escape).join(',')).join('\n')
  return `${header}\n${body}`
}

const getUserById = async (organizationId: string, id: string) => {
  const objectId = asUserObjectId(id)
  if (!objectId) throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  const result = await findUserWithProfiles({ _id: objectId, organizationId })
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
  const nextLicenseNumber = userData.licenseNumber ?? currentRoleFields.licenseNumber
  await syncRoleProfile(user._id, organizationId, user.userRole, {
    licenseNumber: nextLicenseNumber,
    showAsLicensedBroker: String(nextLicenseNumber || '').trim() ? currentRoleFields.showAsLicensedBroker : false,
    specialization: userData.specialization ?? currentRoleFields.specialization,
    serviceAreas: userData.serviceAreas ?? currentRoleFields.serviceAreas,
  })
  if (userData.accessControl !== undefined) await markSessionAuthorizationChanged(user._id, organizationId, 'access_policy_changed')
  const readModel = await findUserWithProfiles({ _id: user._id, organizationId })
  if (!readModel) throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  await CacheInvalidationService.invalidateTenant(organizationId)
  RealtimeService.emitOrganization(organizationId, { type: 'team.changed', action: 'updated', entityId: user._id.toString() })
  return toUserDto(readModel, { includeAccessControl: true, includePrivateProfile: true, includePermissions: true })
}

const deleteUserById = async (organizationId: string, id: string) => {
  const objectId = asUserObjectId(id)
  if (!objectId) throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  const user = await findUserWithProfiles({ _id: objectId, organizationId, userRole: { $ne: 'agency_owner' } })
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
  RealtimeService.emitOrganization(organizationId, { type: 'team.changed', action: 'deleted', entityId: id })
  return dto
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const superAdminUserWhere = (filters: IUserFilter) => {
  const { searchTerm: _searchTerm, userRole, status, ...filtersData } = filters
  const andConditions: any[] = []
  if (userRole) andConditions.push({ userRole })
  if (status) andConditions.push({ status })
  const entries = Object.entries(filtersData).filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (entries.length) andConditions.push({ $and: entries.map(([field, value]) => ({ [field]: value })) })
  return andConditions.length ? { $and: andConditions } : {}
}

const superAdminExportWhere = (filters: IUserFilter) => {
  const base = superAdminUserWhere(filters) as Record<string, unknown>
  if (!filters.searchTerm) return base
  const search = escapeRegex(String(filters.searchTerm).trim())
  const searchCondition = { $or: ['name', 'email', 'phoneNumber', 'organizationId'].map((field) => ({ [field]: { $regex: search, $options: 'i' } })) }
  return Object.keys(base).length ? { $and: [base, searchCondition] } : searchCondition
}

const getAllUsersSuperAdmin = async (filters: IUserFilter, paginationOptions: IPaginationOptions) => {
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination({ ...paginationOptions, limit: paginationOptions.limit || 10 })
  const whereConditions = superAdminUserWhere(filters)
  const sortConditions = paginationHelper.buildAllowedStableSort(sortBy, sortOrder, USER_LIST_SORT_FIELDS, 'createdAt')
  const { rows, total } = await paginateUsersWithProfiles({
    match: whereConditions,
    searchTerm: filters.searchTerm,
    sort: sortConditions,
    skip,
    limit,
  })
  return { meta: { page, limit, total }, data: rows.map((user) => toUserDto(user, { includeAccessControl: true, includePrivateProfile: true })) }
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
  User.find(superAdminExportWhere(filters)).select('name email phoneNumber userRole organizationId status createdAt').sort({ createdAt: -1, _id: -1 }).lean().cursor()

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
  const previousStatus = user.status
  user.userRole = resultingRole
  user.status = resultingStatus
  if (changes.status === 'blocked') {
    // A platform suspension must always become the authoritative restriction,
    // even if the account was already quota- or tenant-blocked. Otherwise a
    // later plan upgrade could incorrectly auto-reactivate it.
    user.accessRestriction = {
      source: 'platform_admin',
      reason,
      blockedAt: new Date(),
      blockedBy: actorId || '',
      previousStatus: user.accessRestriction?.previousStatus === 'pending' || previousStatus === 'pending' ? 'pending' : 'active',
    }
  } else if (changes.status === 'active' && previousStatus === 'blocked') {
    user.accessRestriction = undefined
  }
  await user.save()
  if (resultingRole !== previousRole) await syncRoleProfile(user._id, user.organizationId, resultingRole, roleFields)
  if (resultingRole !== previousRole || resultingStatus !== previousStatus) await markSessionAuthorizationChanged(user._id, user.organizationId, resultingRole !== previousRole ? 'role_changed' : 'status_changed', resultingStatus !== 'active')

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
        RealtimeService.emitOrganization(user.organizationId, { type: 'auth.changed', action: 'authorization_changed', forceLogout: true, entityId: 'tenant_suspended' })
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
  const readModel = await findUserWithProfiles({ _id: user._id })
  if (!readModel) throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  if (user.organizationId) RealtimeService.emitOrganization(user.organizationId, { type: 'team.changed', action: 'updated', entityId: user._id.toString() })
  RealtimeService.emitRole('super-admin', { type: 'platform.notification.changed', action: 'updated', entityId: user._id.toString() })
  return toUserDto(readModel, { includeAccessControl: true, includePrivateProfile: true })
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
  await markSessionAuthorizationChanged(target._id, organizationId, 'access_policy_changed')
  await CacheInvalidationService.invalidateTenant(organizationId)
  const readModel = await findUserWithProfiles({ _id: target._id, organizationId })
  if (!readModel) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found')
  RealtimeService.emitOrganization(organizationId, { type: 'team.changed', action: 'updated', entityId: target._id.toString() })
  return toUserDto(readModel, { includeAccessControl: true, includePrivateProfile: true, includePermissions: true })
}


const updateMemberSeatAccess = async (
  organizationId: string,
  actorUserId: string,
  targetUserId: string,
  active: boolean,
) => {
  if (String(actorUserId) === String(targetUserId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'You cannot block or unblock your own agency-owner seat')
  }

  const changedAt = new Date()
  const userId = asUserObjectId(targetUserId)
  if (!userId) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found')

  await EntitlementService.withTeamMemberQuotaGuard(organizationId, async (session) => {
    const targetQuery = User.findOne({ _id: userId, organizationId })
    if (session) targetQuery.session(session)
    const target = await targetQuery
    if (!target) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found')
    if (target.userRole === 'agency_owner') throw new ApiError(httpStatus.FORBIDDEN, 'Agency owner seat cannot be blocked')
    if (!TEAM_MEMBER_SEAT_ROLES.includes(target.userRole as any)) throw new ApiError(httpStatus.BAD_REQUEST, 'This account does not consume a team seat')

    if (active) {
      if (target.status !== 'blocked') return
      const source = target.accessRestriction?.source
      if (source === 'platform_admin' || !source) {
        throw new ApiError(httpStatus.FORBIDDEN, 'This member was suspended by the platform and cannot be reactivated from the agency dashboard', '', 'PLATFORM_RESTRICTION')
      }

      const quota = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId, session)
      if (quota.teamMembersCommitted + 1 > quota.maxTeamMembers) {
        throw new ApiError(
          httpStatus.CONFLICT,
          `Team seat limit reached (${quota.teamMembersCommitted}/${quota.maxTeamMembers}). Block another member or revoke a pending invitation first.`,
          '',
          'TEAM_SEAT_LIMIT_REACHED',
          {
            maxTeamMembers: quota.maxTeamMembers,
            teamMembersUsed: quota.teamMembersUsed,
            teamMembersReserved: quota.teamMembersReserved,
            teamMembersCommitted: quota.teamMembersCommitted,
            teamMembersAvailable: quota.teamMembersAvailable,
          },
        )
      }

      target.status = target.accessRestriction?.previousStatus === 'pending' ? 'pending' : 'active'
      target.accessRestriction = undefined
      await target.save(session ? { session } : undefined)
      return
    }

    if (target.status === 'blocked') {
      if (target.accessRestriction?.source === 'platform_admin' || !target.accessRestriction?.source) {
        throw new ApiError(httpStatus.FORBIDDEN, 'This member is already restricted by the platform', '', 'PLATFORM_RESTRICTION')
      }
      if (target.accessRestriction?.source === 'tenant_admin') return
    }

    const previousStatus = target.status === 'pending' ? 'pending' : 'active'
    target.status = 'blocked'
    target.accessRestriction = {
      source: 'tenant_admin',
      reason: 'Agency owner blocked this member',
      blockedAt: changedAt,
      blockedBy: actorUserId,
      previousStatus,
    }
    await target.save(session ? { session } : undefined)
    await AuthSession.updateMany(
      { userId: target._id, revokedAt: null },
      { $set: { revokedAt: changedAt, revokeReason: 'tenant_member_blocked' } },
      session ? { session } : undefined,
    )
  })

  await CacheInvalidationService.invalidateTenant(organizationId)
  const readModel = await findUserWithProfiles({ _id: userId, organizationId })
  if (!readModel) throw new ApiError(httpStatus.NOT_FOUND, 'Team member not found')
  const result = toUserDto(readModel, { includeAccessControl: true, includePrivateProfile: true, includePermissions: true })
  RealtimeService.emitAuthorizationChanged({
    userId: String(userId),
    organizationId,
    forceLogout: result.status === 'blocked',
    reason: result.status === 'blocked' ? 'tenant_member_blocked' : 'tenant_member_unblocked',
  })
  RealtimeService.emitOrganization(organizationId, { type: 'team.changed', action: 'updated', entityId: String(userId) })
  return result
}

export const UserService = {
  createUser,
  getAllUsers,
  getTeamRoleSummary,
  getPublicAgents,
  getPublicAgentDetail,
  updatePublicBrokerProfile,
  getAgentLeaderboard, exportTeamMembersCsv,
  getUserById,
  updateUserById,
  deleteUserById,
  getAllUsersSuperAdmin,
  getSuperAdminUserSummary,
  getAllUsersSuperAdminExportCursor,
  updateUserRoleSuperAdmin,
  getMyAccess,
  updateMemberAccess,
  updateMemberSeatAccess,
}
