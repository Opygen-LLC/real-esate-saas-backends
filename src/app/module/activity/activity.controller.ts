import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { ActivityService } from './activity.service'
import { requireTenant } from '../../middlewares/auth'

const createActivity = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  const agentId = req.user?._id || req.user?.id
  const result = await ActivityService.createActivity(organizationId, {
    ...req.body,
    agentId,
  })

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Activity logged successfully',
    data: result,
  })
})

const getActivitiesByLead = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const { leadId } = req.params
  const paginationOptions = pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])
  const result = await ActivityService.getActivitiesByLead(organizationId, leadId, paginationOptions)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Activity feed fetched successfully',
    meta: result.meta,
    data: result.data,
  })
})

export const ActivityController = {
  createActivity,
  getActivitiesByLead,
}
