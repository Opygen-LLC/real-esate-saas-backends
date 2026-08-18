import { Request, Response } from 'express'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { WhatsAppService } from './whatsapp.service'
import { crmAccessFromRequest } from '../crm/crmAccess'
const get = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'WhatsApp integration fetched', data: await WhatsAppService.get(requireTenant(req)) }))
const save = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'WhatsApp integration saved', data: await WhatsAppService.save(requireTenant(req), req.body) }))
const verify = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'WhatsApp integration verified', data: await WhatsAppService.verify(requireTenant(req)) }))
const disable = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'WhatsApp integration disabled', data: await WhatsAppService.disable(requireTenant(req)) }))
const link = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'WhatsApp deep link created', data: { url: WhatsAppService.deepLink(req.query.phone as string, req.query.text as string) } }))
const sendTemplate = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 202, success: true, message: 'WhatsApp message accepted', data: await WhatsAppService.sendTemplate(requireTenant(req), { ...req.body, actorId: req.user?._id }, crmAccessFromRequest(req)) }))
export const WhatsAppController = { get, save, verify, disable, link, sendTemplate }
