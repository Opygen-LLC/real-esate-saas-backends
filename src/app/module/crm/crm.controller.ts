import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { CrmService } from './crm.service'

const getConfig = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'CRM configuration fetched', data: await CrmService.getConfig(requireTenant(req)) }))
const updateConfig = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'CRM configuration updated', data: await CrmService.updateConfig(requireTenant(req), req.body) }))
const assignmentHistory = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Assignment history fetched', data: await CrmService.getAssignmentHistory(requireTenant(req), req.params.leadId) }))

export const CrmController = { getConfig, updateConfig, assignmentHistory }
