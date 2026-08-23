import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { LeadPurchaseRequestService } from './leadPurchaseRequest.service'

const tenantList = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Lead purchase requests fetched successfully', data: await LeadPurchaseRequestService.tenantRequests(requireTenant(req)) }))

const create = catchAsync(async (req: Request, res: Response) => {
  const result = await LeadPurchaseRequestService.createRequest(requireTenant(req), req.user!._id!, req.user!.userRole, req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Additional lead request submitted for Super Admin approval', data: result })
})

const cancel = catchAsync(async (req: Request, res: Response) => {
  const result = await LeadPurchaseRequestService.cancelRequest(requireTenant(req), req.params.id, req.user!._id!, req.user!.userRole)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Lead purchase request cancelled', data: result })
})

const adminList = catchAsync(async (req: Request, res: Response) => {
  const result = await LeadPurchaseRequestService.adminList(req.query)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Lead purchase requests fetched successfully', data: result.data, meta: result.meta })
})

const decision = catchAsync(async (req: Request, res: Response) => {
  const result = await LeadPurchaseRequestService.decide(req.params.id, req.user!._id!, req.body, { requestId: req.requestId, ip: req.ip })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: req.body.status === 'approved' ? 'Lead purchase request approved and capacity granted' : 'Lead purchase request rejected', data: result })
})

export const LeadPurchaseRequestController = { tenantList, create, cancel, adminList, decision }
