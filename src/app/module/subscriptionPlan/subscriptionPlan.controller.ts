import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { SubscriptionPlanService } from './subscriptionPlan.service'
import { writeAudit } from '../audit/audit.service'

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
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'plan.created', entityType: 'subscriptionPlan',
    entityId: (result as any)._id.toString(), requestId: req.requestId, ip: req.ip })
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
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'plan.updated', entityType: 'subscriptionPlan', entityId: id,
    requestId: req.requestId, ip: req.ip, metadata: { fields: Object.keys(req.body) } })
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
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'plan.deleted', entityType: 'subscriptionPlan', entityId: id,
    requestId: req.requestId, ip: req.ip })
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
