import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { UserService } from './user.service'
import { requireTenant } from '../../middlewares/auth'
import { writeAudit } from '../audit/audit.service'
import { TeamInvitationService } from '../teamInvitation/teamInvitation.service'

const createUser = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.createUser(requireTenant(req), req.body, req.user!._id!)
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'User created successfully',
    data: result,
  })
})

const inviteAgent = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await TeamInvitationService.createInvitation(organizationId, req.user!._id!, req.body)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Invitation email sent successfully',
    data: result,
  })
})

const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ['searchTerm', 'organizationId', 'userRole', 'status'])
  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])

  // If agency admin/owner, force organizationId scoping
  filters.organizationId = requireTenant(req)

  const result = await UserService.getAllUsers(filters, paginationOptions)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Users fetched successfully',
    meta: result.meta,
    data: result.data,
  })
})

const getTeamRoleSummary = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.getTeamRoleSummary(requireTenant(req))

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Team role summary fetched successfully',
    data: result,
  })
})

const getPublicAgents = catchAsync(async (req: Request, res: Response) => {
  const { organizationId } = req.params
  const result = await UserService.getPublicAgents(organizationId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Public agents fetched successfully',
    data: result,
  })
})

const getPublicAgentDetail = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await UserService.getPublicAgentDetail(id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Public broker detail fetched successfully',
    data: result,
  })
})

const updatePublicBrokerProfile = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await UserService.updatePublicBrokerProfile(organizationId, req.user!._id!, req.params.id, req.body)
  await writeAudit({
    organizationId, actorId: req.user!._id!, actorRole: req.user!.userRole,
    action: 'team.public_broker_updated', entityType: 'user', entityId: req.params.id,
    reason: req.body.showAsLicensedBroker ? 'Public licensed broker profile enabled or updated' : 'Public licensed broker profile disabled',
    requestId: req.requestId, ip: req.ip,
    metadata: { showAsLicensedBroker: result.showAsLicensedBroker, hasLicenseNumber: Boolean(result.licenseNumber) },
  })
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.showAsLicensedBroker ? 'Public broker profile enabled' : 'Public broker profile disabled',
    data: result,
  })
})

const getAgentLeaderboard = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])
  const result = await UserService.getAgentLeaderboard(organizationId, req.query.startDate as string | undefined, req.query.endDate as string | undefined, paginationOptions)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Agent leaderboard fetched successfully',
    data: result.data,
    meta: result.meta,
  })
})

const exportTeamMembersCsv = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ['searchTerm', 'userRole', 'status'])
  const csv = await UserService.exportTeamMembersCsv(requireTenant(req), filters)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="team-members-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.status(httpStatus.OK).send(`\uFEFF${csv}`)
})

const getUserById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await UserService.getUserById(requireTenant(req), id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User fetched successfully',
    data: result,
  })
})

const updateUserById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await UserService.updateUserById(requireTenant(req), id, req.body)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User updated successfully',
    data: result,
  })
})

const deleteUserById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await UserService.deleteUserById(requireTenant(req), id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User deleted successfully',
    data: result,
  })
})


const getMyProfile = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.getUserById(requireTenant(req), req.user!._id!)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Profile fetched successfully', data: result })
})

const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.updateUserById(requireTenant(req), req.user!._id!, req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Profile updated successfully', data: result })
})

const getMyAccess = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.getMyAccess(requireTenant(req), req.user!._id!)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Access policy fetched', data: result })
})

const updateMemberAccess = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await UserService.updateMemberAccess(organizationId, req.user!._id!, req.params.id, req.body)
  await writeAudit({ organizationId, actorId: req.user!._id!, actorRole: req.user!.userRole,
    action: 'team.access_updated', entityType: 'user', entityId: req.params.id,
    reason: 'Agency owner updated team member role or dashboard access', requestId: req.requestId, ip: req.ip,
    metadata: { userRole: result.userRole, useRoleDefaults: result.accessControl?.useRoleDefaults, permissions: result.permissions } })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Team member access updated', data: result })
})

const updateMemberSeatAccess = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await UserService.updateMemberSeatAccess(organizationId, req.user!._id!, req.params.id, req.body.active)
  await writeAudit({
    organizationId,
    actorId: req.user!._id!,
    actorRole: req.user!.userRole,
    action: req.body.active ? 'team.member_unblocked' : 'team.member_blocked',
    entityType: 'user',
    entityId: req.params.id,
    reason: req.body.active ? 'Tenant administrator restored a team seat' : 'Tenant administrator blocked a team member',
    requestId: req.requestId,
    ip: req.ip,
    metadata: { status: result.status, restrictionSource: result.accessRestriction?.source || null },
  })
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: req.body.active ? 'Team member unblocked' : 'Team member blocked',
    data: result,
  })
})

const getAllUsersSuperAdmin = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ['searchTerm', 'userRole', 'status', 'organizationId'])
  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])
  const result = await UserService.getAllUsersSuperAdmin(filters, paginationOptions)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Super-admin users directory fetched successfully',
    meta: result.meta,
    data: result.data,
  })
})


const getSuperAdminUserSummary = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Global platform user statistics fetched successfully', data: await UserService.getSuperAdminUserSummary() })
})

const csvCell = (value: unknown) => {
  let text = String(value ?? '')
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`

}

const exportUsersSuperAdminCsv = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ['searchTerm', 'userRole', 'status', 'organizationId'])
  res.status(httpStatus.OK)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="platform-users-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.write('\uFEFFName,Email,Phone,Role,Organization,Status,Created At\n')
  const cursor = UserService.getAllUsersSuperAdminExportCursor(filters)
  for await (const user of cursor as any) {
    res.write([user.name, user.email, user.phoneNumber, user.userRole, user.organizationId || 'Platform', user.status || 'active', user.createdAt ? new Date(user.createdAt).toISOString() : ''].map(csvCell).join(',') + '\n')
  }
  res.end()
})

const verifyUserSuperAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.verifyUserSuperAdmin(req.params.id, {
    actorId: req.user!._id!,
    reason: req.body.reason,
    requestId: req.requestId,
    ip: req.ip,
  })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.alreadyVerified ? 'User is already verified' : 'User verified successfully by super-admin',
    data: result,
  })
})

const updateUserRoleSuperAdmin = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await UserService.updateUserRoleSuperAdmin(id, req.body, req.user!._id!)
  await writeAudit({ organizationId: result?.organizationId, actorId: req.user!._id!, actorRole: 'super-admin',
    action: 'user.platform_updated', entityType: 'user', entityId: id, reason: req.body.reason, requestId: req.requestId, ip: req.ip,
    metadata: { fields: Object.keys(req.body).filter((field) => field !== 'reason') } })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User access updated by super-admin',
    data: result,
  })
})

export const UserController = {
  createUser,
  inviteAgent,
  getAllUsers,
  getTeamRoleSummary,
  getPublicAgents,
  getPublicAgentDetail,
  updatePublicBrokerProfile,
  getAgentLeaderboard,
  exportTeamMembersCsv,
  getUserById,
  updateUserById,
  deleteUserById,
  getAllUsersSuperAdmin,
  getSuperAdminUserSummary,
  exportUsersSuperAdminCsv,
  updateUserRoleSuperAdmin,
  verifyUserSuperAdmin,
  getMyAccess,
  getMyProfile,
  updateMyProfile,
  updateMemberAccess,
  updateMemberSeatAccess,
}
