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

const createPlan = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionPlanService.createPlan(req.body)
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Subscription plan created successfully',
    data: result,
  })
})

const updatePlan = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await SubscriptionPlanService.updatePlan(id, req.body)
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Subscription plan updated successfully',
    data: result,
  })
})

const deletePlan = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await SubscriptionPlanService.deletePlan(id)
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Subscription plan deleted successfully',
    data: result,
  })
})

export const SubscriptionPlanController = {
  getAllPlans,
  createPlan,
  updatePlan,
  deletePlan,
}
