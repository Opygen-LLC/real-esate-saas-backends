import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { SubscriptionPlanService } from './subscriptionPlan.service'
import { writeAudit } from '../audit/audit.service'

const getAllPlans = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Subscription plans fetched successfully', data: await SubscriptionPlanService.getAllPlans() })
})

const getAllPlanVersions = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Plan version history fetched successfully', data: await SubscriptionPlanService.getAllPlanVersions(req.query.planId as string | undefined) })
})

const createPlan = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionPlanService.createPlan(req.body, req.user!._id!)
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'plan.created', entityType: 'subscriptionPlan',
    entityId: (result as any)._id.toString(), reason: req.body.changeReason, requestId: req.requestId, ip: req.ip,
    metadata: { planId: result.planId, version: result.version, effectiveFrom: result.effectiveFrom, grandfatherExisting: result.grandfatherExisting } })
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Subscription plan created successfully', data: result })
})

const updatePlan = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionPlanService.createVersion(req.params.id, req.body, req.user!._id!)
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'plan.version_created', entityType: 'subscriptionPlan',
    entityId: (result as any)._id.toString(), reason: req.body.changeReason, requestId: req.requestId, ip: req.ip,
    metadata: { planId: result.planId, version: result.version, effectiveFrom: result.effectiveFrom, grandfatherExisting: result.grandfatherExisting, fields: Object.keys(req.body) } })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'New subscription plan version created successfully', data: result })
})

const deletePlan = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionPlanService.deletePlan(req.params.id)
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'plan.archived', entityType: 'subscriptionPlan', entityId: req.params.id,
    reason: req.body.reason, requestId: req.requestId, ip: req.ip,
    metadata: { planId: result.planId, version: result.version } })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Subscription plan version archived successfully', data: result })
})

export const SubscriptionPlanController = { getAllPlans, getAllPlanVersions, createPlan, updatePlan, deletePlan }
