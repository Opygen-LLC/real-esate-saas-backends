import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { DomainService } from './domain.service'

const getCustomDomain = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Custom domain status fetched', data: await DomainService.get(requireTenant(req)) }))
const addCustomDomain = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Domain configuration initiated', data: await DomainService.add(requireTenant(req), req.body.domain) }))
const verifyCustomDomain = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Domain lifecycle check completed', data: await DomainService.verify(requireTenant(req)) }))
const resolveHost = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Host resolution completed', data: { organizationId: await DomainService.resolveVerifiedDomain(req.params.host) } }))
export const DomainController = { getCustomDomain, addCustomDomain, verifyCustomDomain, resolveHost }
