import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { FinanceInitializationService } from './financeInitialization.service'
import type { AccountingActor } from './financeAccounting.interface'

const actor = (req: Request): AccountingActor => ({ id: String(req.user?._id || ''), role: req.user?.userRole, requestId: req.requestId, ip: req.ip, permissions: req.tenant?.permissions || [] })
const status = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Accounting initialization status fetched', data: await FinanceInitializationService.getStatus(requireTenant(req)) }))
const preview = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Historical finance migration preview generated', data: await FinanceInitializationService.preview(requireTenant(req), actor(req), req.query.startDate) }))
const mappings = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Legacy payment mappings fetched', data: await FinanceInitializationService.getMappings(requireTenant(req)) }))
const setMapping = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Legacy payment mapping updated', data: await FinanceInitializationService.setPaymentMethodMapping(requireTenant(req), actor(req), req.body) }))
const activate = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Historical accounting migration activated', data: await FinanceInitializationService.activate(requireTenant(req), actor(req), req.body) }))
export const FinanceInitializationController = { status, preview, mappings, setMapping, activate }
