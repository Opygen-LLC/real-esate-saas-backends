import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import type { AccountingActor } from './financeAccounting.interface'
import { FinanceCloseService } from './financeClose.service'
const actor = (req: Request): AccountingActor => ({ id: String(req.user?._id || ''), role: req.user?.userRole, requestId: req.requestId, ip: req.ip, permissions: req.tenant?.permissions || [] })
const checklist = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Period close checklist fetched', data: await FinanceCloseService.periodChecklist(requireTenant(req), req.params.id) }))
const closePeriod = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Fiscal period closed', data: await FinanceCloseService.closePeriod(requireTenant(req), actor(req), req.params.id, req.body.reason) }))
const reopenPeriod = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Fiscal period reopened', data: await FinanceCloseService.reopenPeriod(requireTenant(req), actor(req), req.params.id, req.body.reason) }))
const closeFiscalYear = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Fiscal year closed with controlled closing journals', data: await FinanceCloseService.yearEndClose(requireTenant(req), actor(req), req.params.id, req.body.reason) }))
const auditLog = catchAsync(async (req: Request, res: Response) => { const result = await FinanceCloseService.auditLog(requireTenant(req), req.query); sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Finance audit trail fetched', data: result.data, meta: result.meta }) })
export const FinanceCloseController = { checklist, closePeriod, reopenPeriod, closeFiscalYear, auditLog }
