import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { requireTenant } from '../../middlewares/auth'
import { crmRecordReadAccessFromRequest } from '../crm/crmAccess'
import { WebsiteSubmissionService } from './websiteSubmission.service'

const readOptions = (req: Request) => {
  const permissions = req.tenant?.permissions || []
  const includeLeadDetails = permissions.includes('leads.read')
  const includeViewingDetails = permissions.includes('viewings.read')
  return {
    includeLeadDetails,
    includeViewingDetails,
    crmAccess: includeLeadDetails || includeViewingDetails ? crmRecordReadAccessFromRequest(req) : undefined,
  }
}

const list = catchAsync(async (req: Request, res: Response) => {
  const result = await WebsiteSubmissionService.list(
    requireTenant(req),
    pick(req.query, ['searchTerm', 'submissionType', 'status', 'propertyId', 'sourcePage', 'submittedFrom', 'submittedTo']),
    pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder']),
    readOptions(req),
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
  data: await WebsiteSubmissionService.getById(requireTenant(req), req.params.id, readOptions(req)),
}))

const updateStatus = catchAsync(async (req: Request, res: Response) => sendResponse(res, {
  statusCode: httpStatus.OK,
  success: true,
  message: 'Website submission status updated successfully',
  data: await WebsiteSubmissionService.updateStatus(requireTenant(req), req.params.id, req.body.status, readOptions(req)),
}))

export const WebsiteSubmissionController = { list, getById, updateStatus }
