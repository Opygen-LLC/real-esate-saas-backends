import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { SubscriptionPlanService } from './subscriptionPlan.service'

const getAllPlans = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionPlanService.getAllPlans()

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Subscription plans fetched successfully',
    data: result,
  })
})

export const SubscriptionPlanController = {
  getAllPlans,
}
