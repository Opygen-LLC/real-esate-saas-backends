import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { requireTenant } from '../../middlewares/auth'
import { WebsiteSubmissionService } from './websiteSubmission.service'

const list = catchAsync(async (req: Request, res: Response) => {
  const result = await WebsiteSubmissionService.list(
    requireTenant(req),
    pick(req.query, ['searchTerm', 'submissionType', 'status', 'propertyId', 'sourcePage', 'submittedFrom', 'submittedTo']),
    pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder']),
  )
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Website submissions fetched successfully',
    meta: result.meta,
    data: result.data,
  })
})

const getById = catchAsync(async (req: Request, res: Response) => sendResponse(res, {
  statusCode: httpStatus.OK,
  success: true,
  message: 'Website submission fetched successfully',
  data: await WebsiteSubmissionService.getById(requireTenant(req), req.params.id),
}))

const updateStatus = catchAsync(async (req: Request, res: Response) => sendResponse(res, {
  statusCode: httpStatus.OK,
  success: true,
  message: 'Website submission status updated successfully',
  data: await WebsiteSubmissionService.updateStatus(requireTenant(req), req.params.id, req.body.status),
}))

export const WebsiteSubmissionController = { list, getById, updateStatus }
