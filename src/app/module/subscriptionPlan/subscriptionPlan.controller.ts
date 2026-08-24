import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { SubscriptionPlanService } from './subscriptionPlan.service'
import { writeAudit } from '../audit/audit.service'
import { toTeamMemberLimitContract } from '../../../contracts/workspaceContracts'

const getAllPlans = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Subscription plans fetched successfully', data: (await SubscriptionPlanService.getAllPlans()).map((plan: any) => toTeamMemberLimitContract(plan)) })
})

const getAllPlanVersions = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionPlanService.getAllPlanVersions(req.query as any)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Plan version history fetched successfully', data: result.data.map((plan: any) => toTeamMemberLimitContract(plan)), meta: result.meta })
})

const createPlan = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionPlanService.createPlan(req.body, req.user!._id!)
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'plan.created', entityType: 'subscriptionPlan',
    entityId: (result as any)._id.toString(), reason: req.body.changeReason, requestId: req.requestId, ip: req.ip,
    metadata: { planId: result.planId, version: result.version, status: result.status } })
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Subscription plan created successfully', data: toTeamMemberLimitContract(result as any) })
})

const updatePlan = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionPlanService.createVersion(req.params.id, req.body, req.user!._id!)
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'plan.version_created', entityType: 'subscriptionPlan',
    entityId: (result as any)._id.toString(), reason: req.body.changeReason, requestId: req.requestId, ip: req.ip,
    metadata: { planId: result.planId, version: result.version, status: result.status, previousVersionId: req.params.id, fields: Object.keys(req.body) } })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'New subscription plan version created successfully', data: toTeamMemberLimitContract(result as any) })
})

const deletePlan = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionPlanService.deletePlan(req.params.id)
  await writeAudit({ actorId: req.user!._id!, actorRole: 'super-admin', action: 'plan.retired', entityType: 'subscriptionPlan', entityId: req.params.id,
    reason: req.body.reason, requestId: req.requestId, ip: req.ip,
    metadata: { planId: result.planId, version: result.version } })
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Subscription plan version retired successfully', data: toTeamMemberLimitContract(result as any) })
})

export const SubscriptionPlanController = { getAllPlans, getAllPlanVersions, createPlan, updatePlan, deletePlan }
