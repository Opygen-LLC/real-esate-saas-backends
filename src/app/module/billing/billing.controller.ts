import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { BillingService } from './billing.service'
import ApiError from '../../../errors/ApiError'
import { requireTenant } from '../../middlewares/auth'

const getBillingHistory = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await BillingService.getBillingHistory(organizationId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Billing history fetched successfully',
    data: result,
  })
})

const getSubscriptionUsage = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await BillingService.getSubscriptionUsage(organizationId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Subscription usage and plan limit status fetched successfully',
    data: result,
  })
})

const changeSubscriptionPlan = catchAsync(async (req: Request, res: Response) => {
  throw new ApiError(
    httpStatus.PAYMENT_REQUIRED,
    'Direct plan changes are disabled. Create a bKash checkout at /billing/bkash/create.'
  )
})

const cancelSubscription = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const result = await BillingService.cancelSubscription(organizationId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Subscription canceled successfully',
    data: result,
  })
})

const getInvoiceReceipt = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const { id } = req.params
  const html = await BillingService.getInvoiceReceipt(organizationId, id)

  res.setHeader('Content-Type', 'text/html')
  res.status(httpStatus.OK).send(html)
})

export const BillingController = {
  getBillingHistory,
  getSubscriptionUsage,
  changeSubscriptionPlan,
  cancelSubscription,
  getInvoiceReceipt,
}
