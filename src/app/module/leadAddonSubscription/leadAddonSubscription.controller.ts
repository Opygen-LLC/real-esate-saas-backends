import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { LeadAddonSubscriptionService } from './leadAddonSubscription.service'

const quote = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Recurring lead add-on quote calculated successfully', data: await LeadAddonSubscriptionService.quote(requireTenant(req), req.body.definitionId) }))
const subscribe = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Recurring lead add-on request created. Complete payment to activate it.', data: await LeadAddonSubscriptionService.createSubscription(requireTenant(req), req.user!._id!, req.body) }))
const listTenant = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Recurring lead add-ons fetched successfully', data: await LeadAddonSubscriptionService.listTenant(requireTenant(req)) }))
const cancel = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Recurring lead add-on cancellation updated successfully', data: await LeadAddonSubscriptionService.cancel(requireTenant(req), req.params.id, req.user!._id!) }))
const listAdmin = catchAsync(async (req: Request, res: Response) => { const result = await LeadAddonSubscriptionService.listAdmin(req.query); sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Recurring lead add-on subscriptions fetched successfully', data: result.data, meta: result.meta }) })
const decide = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: req.body.status === 'active' ? 'Recurring lead add-on activated successfully' : 'Recurring lead add-on rejected successfully', data: await LeadAddonSubscriptionService.decide(req.params.id, req.body, req.user!._id!) }))
export const LeadAddonSubscriptionController = { quote, subscribe, listTenant, cancel, listAdmin, decide }
