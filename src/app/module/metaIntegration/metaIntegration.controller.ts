import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { MetaIntegrationService } from './metaIntegration.service'

const get = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Meta integration fetched', data: await MetaIntegrationService.get(requireTenant(req)) }))
const save = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Meta integration saved securely', data: await MetaIntegrationService.save(requireTenant(req), req.body) }))
const test = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Meta CAPI test completed', data: await MetaIntegrationService.test(requireTenant(req), req.body.eventSourceUrl) }))
const publicConfig = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Meta browser configuration fetched', data: await MetaIntegrationService.publicConfig(req.params.identifier) }))
const capture = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.ACCEPTED, success: true, message: 'Meta event accepted', data: await MetaIntegrationService.queuePublicEvent(req.params.identifier, req.body, { ip: req.ip, userAgent: req.get('user-agent') }) }))
const deadLetters = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Meta dead letters fetched', data: await MetaIntegrationService.deadLetters(requireTenant(req)) }))
const retryDead = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: 200, success: true, message: 'Meta event requeued', data: await MetaIntegrationService.retryDeadLetter(requireTenant(req), req.params.id) }))
export const MetaIntegrationController = { get, save, test, publicConfig, capture, deadLetters, retryDead }
