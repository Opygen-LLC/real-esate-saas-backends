import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { LeadTopupPricingService } from './leadTopupPricing.service'
import { writeAudit } from '../audit/audit.service'

const listPublic = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Active lead top-up pricing fetched successfully', data: await LeadTopupPricingService.getActivePricing() })
})

const listAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await LeadTopupPricingService.getAdminPricing(req.query)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Lead top-up pricing fetched successfully', data: result.data, meta: result.meta })
})

const create = catchAsync(async (req: Request, res: Response) => {
  const result: any = await LeadTopupPricingService.createPricing(req.body, req.user!._id!)
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'lead_topup.pricing_created', entityType: 'leadTopupPricing', entityId: String(result._id), reason: req.body.reason, requestId: req.requestId, ip: req.ip, metadata: { pricingMode: result.pricingMode, name: result.name } })
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Lead top-up pricing created successfully', data: result })
})

const update = catchAsync(async (req: Request, res: Response) => {
  const result: any = await LeadTopupPricingService.updatePricing(req.params.id, req.body, req.user!._id!)
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'lead_topup.pricing_updated', entityType: 'leadTopupPricing', entityId: String(result._id), reason: req.body.reason, requestId: req.requestId, ip: req.ip, metadata: { pricingMode: result.pricingMode, name: result.name, fields: Object.keys(req.body) } })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Lead top-up pricing updated successfully', data: result })
})

const archive = catchAsync(async (req: Request, res: Response) => {
  const result: any = await LeadTopupPricingService.archivePricing(req.params.id, req.user!._id!)
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'lead_topup.pricing_archived', entityType: 'leadTopupPricing', entityId: String(result._id), reason: req.body.reason, requestId: req.requestId, ip: req.ip, metadata: { pricingMode: result.pricingMode, name: result.name } })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Lead top-up pricing archived successfully', data: result })
})

export const LeadTopupPricingController = { listPublic, listAdmin, create, update, archive }
