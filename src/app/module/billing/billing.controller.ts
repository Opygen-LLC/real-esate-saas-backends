import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { BillingService } from './billing.service'

const getBillingHistory = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const result = await BillingService.getBillingHistory(organizationId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Billing history fetched successfully',
    data: result,
  })
})

const getSubscriptionUsage = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const result = await BillingService.getSubscriptionUsage(organizationId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Subscription usage and plan limit status fetched successfully',
    data: result,
  })
})

const changeSubscriptionPlan = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { plan, billingCycle } = req.body
  const result = await BillingService.changeSubscriptionPlan(organizationId, plan, billingCycle)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Subscription plan updated successfully',
    data: result,
  })
})

export const BillingController = {
  getBillingHistory,
  getSubscriptionUsage,
  changeSubscriptionPlan,
}
