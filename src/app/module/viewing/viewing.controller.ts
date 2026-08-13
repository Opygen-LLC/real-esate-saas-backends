import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { ViewingService } from './viewing.service'
import { requireTenant } from '../../middlewares/auth'

const checkConflict = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { agentId, propertyId, date, startTime, endTime, excludeViewingId } = req.body

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
  const result = await ViewingService.createViewing(organizationId, req.body)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Viewing appointment scheduled successfully',
    data: result,
  })
})

const publicRequestViewing = catchAsync(async (req: Request, res: Response) => {
  const result = await ViewingService.publicRequestViewing(req.body)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Viewing request submitted successfully. The assigned broker will confirm your showing.',
    data: result,
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
  const result = await ViewingService.updateViewing(organizationId, id, req.body)

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
  const result = await ViewingService.deleteViewing(organizationId, id)

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
  getViewingById,
  updateViewing,
  deleteViewing,
}
