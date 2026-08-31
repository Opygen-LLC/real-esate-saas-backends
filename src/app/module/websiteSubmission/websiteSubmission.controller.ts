import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { requireTenant } from '../../middlewares/auth'
import { crmAccessFromRequest, crmRecordReadAccessFromRequest } from '../crm/crmAccess'
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
    pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder', 'cursor']),
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


const moveToCrm = catchAsync(async (req: Request, res: Response) => {
  const actorId = req.user?._id || req.user?.id
  const result = await WebsiteSubmissionService.moveToCrm(
    requireTenant(req),
    req.params.id,
    actorId,
    crmAccessFromRequest(req),
    readOptions(req),
  )
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.alreadyMoved
      ? 'Website submission is already linked to CRM'
      : result.outcome === 'MERGED'
        ? 'Website submission merged with an existing CRM Lead'
        : 'Website submission moved to CRM successfully',
    data: result,
  })
})


const deleteSubmission = catchAsync(async (req: Request, res: Response) => {
  const actorId = req.user?._id || req.user?.id || ''
  const data = await WebsiteSubmissionService.deleteSubmission(
    requireTenant(req),
    { id: String(actorId), role: req.user?.userRole || 'tenant', requestId: req.requestId, ip: req.ip },
    req.params.id,
    req.body?.reason,
  )
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Website submission deleted successfully',
    data,
  })
})

const updateStatus = catchAsync(async (req: Request, res: Response) => sendResponse(res, {
  statusCode: httpStatus.OK,
  success: true,
  message: 'Website submission status updated successfully',
  data: await WebsiteSubmissionService.updateStatus(requireTenant(req), req.params.id, req.body.status, readOptions(req)),
}))

export const WebsiteSubmissionController = { list, getById, updateStatus, deleteSubmission, moveToCrm }
