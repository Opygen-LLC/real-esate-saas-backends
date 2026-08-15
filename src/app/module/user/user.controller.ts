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

const getAgentLeaderboard = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await UserService.getAgentLeaderboard(organizationId, req.query.startDate as string | undefined, req.query.endDate as string | undefined)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Agent leaderboard fetched successfully',
    data: result,
  })
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
  getPublicAgents,
  getPublicAgentDetail,
  getAgentLeaderboard,
  getUserById,
  updateUserById,
  deleteUserById,
  getAllUsersSuperAdmin,
  updateUserRoleSuperAdmin,
  getMyAccess,
  updateMemberAccess,
}
