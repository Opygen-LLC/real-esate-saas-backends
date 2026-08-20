import { Request, Response } from 'express'
import mongoose from 'mongoose'
import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { ViewingService } from './viewing.service'
import { requireTenant } from '../../middlewares/auth'
import { crmAccessFromRequest } from '../crm/crmAccess'
import { WebsiteSubmissionService } from '../websiteSubmission/websiteSubmission.service'

const checkConflict = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { agentId, propertyId, date, startTime, endTime, excludeViewingId } = req.body
  const access = crmAccessFromRequest(req)
  if (!access.isManager && String(agentId) !== access.userId) {
    throw new ApiError(403, 'Team members can only check their own viewing availability')
  }

  const result = await ViewingService.checkConflict(
    organizationId,
    agentId,
    propertyId,
    date,
    startTime,
    endTime,
    excludeViewingId
  )

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Conflict check completed',
    data: result,
  })
})

const createViewing = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await ViewingService.createViewing(organizationId, req.body, req.user?._id || req.user?.id, crmAccessFromRequest(req))

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Viewing appointment scheduled successfully',
    data: result,
  })
})

const publicRequestViewing = catchAsync(async (req: Request, res: Response) => {
  const result = await ViewingService.publicRequestViewing(req.body, { ip: req.ip, requestId: req.requestId })
  const submission = await WebsiteSubmissionService.captureViewing(req.body, result)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Viewing request submitted successfully. The assigned broker will confirm your showing.',
    data: WebsiteSubmissionService.withPublicReceipt(result, submission),
  })
})

const getAllViewings = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, [
    'searchTerm',
    'organizationId',
    'propertyId',
    'agentId',
    'leadId',
    'status',
    'date',
    'startDate',
    'endDate',
    'viewMode',
  ])

  filters.organizationId = requireTenant(req)

  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])
  const result = await ViewingService.getAllViewings(filters, paginationOptions)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Viewings fetched successfully',
    meta: result.meta,
    data: result.data,
  })
})

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_CALENDAR_RANGE_DAYS = 62
const VIEWING_STATUSES = new Set(['Scheduled', 'Confirmed', 'Completed', 'Cancelled', 'NoShow', 'Rescheduled'])

const getCalendarViewings = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const filters = pick(req.query, ['startDate', 'endDate', 'status', 'propertyId', 'agentId'])
  const startDate = String(filters.startDate || '')
  const endDate = String(filters.endDate || '')

  if (!DATE_ONLY_RE.test(startDate) || !DATE_ONLY_RE.test(endDate)) {
    throw new ApiError(400, 'startDate and endDate are required in YYYY-MM-DD format')
  }
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new ApiError(400, 'Invalid viewing calendar date range')
  }
  const rangeDays = Math.floor((end - start) / 86_400_000) + 1
  if (rangeDays > MAX_CALENDAR_RANGE_DAYS) {
    throw new ApiError(400, `Viewing calendar range cannot exceed ${MAX_CALENDAR_RANGE_DAYS} days`)
  }
  if (filters.status && !VIEWING_STATUSES.has(String(filters.status))) throw new ApiError(400, 'Invalid viewing status')
  if (filters.propertyId && !mongoose.isValidObjectId(String(filters.propertyId))) throw new ApiError(400, 'Invalid property filter')
  if (filters.agentId && !mongoose.isValidObjectId(String(filters.agentId))) throw new ApiError(400, 'Invalid agent filter')

  const data = await ViewingService.getCalendarViewings({
    organizationId,
    startDate,
    endDate,
    status: filters.status ? String(filters.status) : undefined,
    propertyId: filters.propertyId ? String(filters.propertyId) : undefined,
    agentId: filters.agentId ? String(filters.agentId) : undefined,
  })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Viewing calendar fetched successfully',
    data,
  })
})

const getViewingById = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { id } = req.params
  const result = await ViewingService.getViewingById(organizationId, id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Viewing fetched successfully',
    data: result,
  })
})

const updateViewing = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { id } = req.params
  const result = await ViewingService.updateViewing(organizationId, id, req.body, req.user?._id || req.user?.id, crmAccessFromRequest(req))

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Viewing updated successfully',
    data: result,
  })
})

const deleteViewing = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { id } = req.params
  const result = await ViewingService.deleteViewing(organizationId, id, crmAccessFromRequest(req))

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Viewing appointment deleted successfully',
    data: result,
  })
})

export const ViewingController = {
  checkConflict,
  createViewing,
  publicRequestViewing,
  getAllViewings,
  getCalendarViewings,
  getViewingById,
  updateViewing,
  deleteViewing,
}
