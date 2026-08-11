import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { UserService } from './user.service'

const createUser = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.createUser(req.body)
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'User created successfully',
    data: result,
  })
})

const inviteAgent = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId || req.body.organizationId) as string
  const result = await UserService.inviteAgent(organizationId, req.body)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Agent invited successfully',
    data: result,
  })
})

const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ['searchTerm', 'organizationId', 'userRole', 'status'])
  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])

  // If agency admin/owner, force organizationId scoping
  if (req.user && req.user.userRole !== 'super-admin' && (req.user.organizationId || req.user.storeId)) {
    filters.organizationId = req.user.organizationId || req.user.storeId
  }

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
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const result = await UserService.getAgentLeaderboard(organizationId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Agent leaderboard fetched successfully',
    data: result,
  })
})

const getUserById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await UserService.getUserById(id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User fetched successfully',
    data: result,
  })
})

const updateUserById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await UserService.updateUserById(id, req.body)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User updated successfully',
    data: result,
  })
})

const deleteUserById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await UserService.deleteUserById(id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User deleted successfully',
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
}
