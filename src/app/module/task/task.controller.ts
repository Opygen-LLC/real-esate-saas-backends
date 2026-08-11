import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { TaskService } from './task.service'

const createTask = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId || req.body.organizationId) as string
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

  if (req.user && req.user.userRole !== 'super-admin' && (req.user.organizationId || req.user.storeId)) {
    filters.organizationId = req.user.organizationId || req.user.storeId
  } else if (req.query.organizationId) {
    filters.organizationId = req.query.organizationId as string
  }

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
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
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
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { id } = req.params
  const result = await TaskService.deleteTask(organizationId, id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Task deleted successfully',
    data: result,
  })
})

export const TaskController = {
  createTask,
  getAllTasks,
  updateTask,
  deleteTask,
}
