import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { TaskService } from './task.service'
import { requireTenant } from '../../middlewares/auth'

const createTask = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await TaskService.createTask(organizationId, req.body)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Task created successfully',
    data: result,
  })
})

const getAllTasks = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, [
    'searchTerm',
    'organizationId',
    'status',
    'priority',
    'assignedAgent',
    'linkedLead',
    'linkedProperty',
    'dueDate',
  ])

  filters.organizationId = requireTenant(req)

  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])
  const result = await TaskService.getAllTasks(filters, paginationOptions)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Tasks fetched successfully',
    meta: result.meta,
    data: result.data,
  })
})

const updateTask = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { id } = req.params
  const result = await TaskService.updateTask(organizationId, id, req.body)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Task updated successfully',
    data: result,
  })
})

const deleteTask = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { id } = req.params
  const result = await TaskService.deleteTask(organizationId, id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Task deleted successfully',
    data: result,
  })
})

const approveTask = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const userId = req.user?.userId || req.user?._id || ''
  const { id } = req.params
  const { approvalStatus } = req.body || { approvalStatus: 'approved' }

  const result = await TaskService.approveTask(organizationId, id, userId, approvalStatus)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Task ${approvalStatus} successfully`,
    data: result,
  })
})

export const TaskController = {
  createTask,
  getAllTasks,
  updateTask,
  deleteTask,
  approveTask,
}
