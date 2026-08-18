import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { CrmService } from './crm.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { crmRecordReadAccessFromRequest } from './crmAccess'

const getAssignees = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'CRM assignees fetched', data: await CrmService.getAssignees(requireTenant(req)) }))
const getConfig = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'CRM configuration fetched', data: await CrmService.getConfig(requireTenant(req)) }))
const updateConfig = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  await EntitlementService.assertFeature(organizationId, 'leadAutomations')
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'CRM configuration updated', data: await CrmService.updateConfig(organizationId, req.body) })
})
const assignmentHistory = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Assignment history fetched', data: await CrmService.getAssignmentHistory(requireTenant(req), req.params.leadId, crmRecordReadAccessFromRequest(req)) }))

export const CrmController = { getAssignees, getConfig, updateConfig, assignmentHistory }
