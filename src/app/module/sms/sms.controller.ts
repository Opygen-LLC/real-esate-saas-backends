import { randomUUID } from 'crypto'
import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { EntitlementService } from '../entitlement/entitlement.service'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { SmsService } from './sms.service'

const send = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  await EntitlementService.assertFeature(organizationId, 'smsAutomation')
  const prepared = await SmsService.prepare(organizationId, { ...req.body, sentBy: req.user?._id })
  const job = await OperationsQueueService.schedule({ organizationId, type: 'sms_send', entityId: `sms-${randomUUID()}`, runAt: new Date(Date.now() + 250), payload: prepared, maxAttempts: 6 })
  sendResponse(res, { statusCode: httpStatus.ACCEPTED, success: true, message: 'SMS queued for delivery', data: { jobId: job?._id, status: 'queued' } })
})
const templates = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'SMS templates fetched', data: await SmsService.listTemplates(requireTenant(req)) }))
const upsertTemplate = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'SMS template saved', data: await SmsService.upsertTemplate(requireTenant(req), req.body) }))
const optOut = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'SMS opt-out saved', data: await SmsService.optOut(requireTenant(req), req.body.phone, req.body.reason) }))
const optIn = catchAsync(async (req: Request, res: Response) => { await SmsService.optIn(requireTenant(req), req.body.phone); sendResponse(res, { statusCode: 200, success: true, message: 'SMS opt-out removed', data: null }) })
const usage = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'SMS usage fetched', data: await SmsService.usage(requireTenant(req), req.query.start as string, req.query.end as string) }))
const receipt = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Delivery receipt processed', data: await SmsService.receipt(req.body) }))
export const SmsController = { send, templates, upsertTemplate, optOut, optIn, usage, receipt }
