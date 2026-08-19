import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { requireTenant } from '../../middlewares/auth'
import { crmAccessFromRequest } from '../crm/crmAccess'
import { TaskService } from './task.service'

const actor = (req: Request) => req.user?._id || req.user?.id

const createTask = catchAsync(async (req: Request, res: Response) => {
  const result = await TaskService.createTask(requireTenant(req), req.body, actor(req), crmAccessFromRequest(req))
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Task created successfully', data: result })
})

const getAllTasks = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ['searchTerm', 'status', 'priority', 'taskType', 'assignedAgent', 'linkedLead', 'linkedProperty', 'dueDate', 'dueFrom', 'dueTo', 'overdue', 'approvalStatus', 'scope'])
  filters.organizationId = requireTenant(req)
  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])
  const result = await TaskService.getAllTasks(filters, paginationOptions, crmAccessFromRequest(req, req.query.scope))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Tasks fetched successfully', meta: result.meta, data: result.data })
})


const getTaskSummary = catchAsync(async (req: Request, res: Response) => {
  const result = await TaskService.getTaskSummary(
    requireTenant(req),
    crmAccessFromRequest(req, req.query.scope),
  )
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'CRM task summary fetched successfully', data: result })
})

const updateTask = catchAsync(async (req: Request, res: Response) => {
  const result = await TaskService.updateTask(requireTenant(req), req.params.id, req.body, actor(req), crmAccessFromRequest(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Task updated successfully', data: result })
})

const deleteTask = catchAsync(async (req: Request, res: Response) => {
  const result = await TaskService.deleteTask(requireTenant(req), req.params.id, crmAccessFromRequest(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Task deleted successfully', data: result })
})

const approveTask = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const userId = req.user?.userId || req.user?._id || ''
  const { approvalStatus } = req.body || { approvalStatus: 'approved' }
  const result = await TaskService.approveTask(organizationId, req.params.id, userId, approvalStatus)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: `Task ${approvalStatus} successfully`, data: result })
})

export const TaskController = { createTask, getAllTasks, getTaskSummary, updateTask, deleteTask, approveTask }
