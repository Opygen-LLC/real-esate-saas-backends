import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { FinanceAccountingSettingsService } from './financeAccountingSettings.service'

const actor = (req: Request) => ({ id: String(req.user?._id || req.user?.id || ''), role: req.user?.userRole || 'tenant', requestId: req.requestId, ip: req.ip })

const get = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceAccountingSettingsService.get(requireTenant(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Accounting settings fetched successfully', data })
})
const update = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceAccountingSettingsService.update(requireTenant(req), actor(req), req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Accounting settings updated successfully', data })
})

export const FinanceAccountingSettingsController = { get, update }
