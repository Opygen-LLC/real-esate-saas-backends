import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { Organization } from '../organization/organization.model'
import { VisitorLog } from './visitorLogs.model'
import { EntitlementService } from '../entitlement/entitlement.service'
import { requireTenant } from '../../middlewares/auth'

const logVisitor = catchAsync(async (req: Request, res: Response) => {
  const { organizationId, urlPath, referrer, device, browser, os } = req.body
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress

  if (organizationId) {
    await EntitlementService.consumeVisitor(organizationId)
    await VisitorLog.create({
      organizationId,
      ip: String(ip),
      urlPath,
      referrer,
      device,
      browser,
      os,
    })

  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Visitor logged',
    data: null,
  })
})

const getVisitorAnalytics = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireTenant(req)
  await EntitlementService.assertFeature(organizationId, 'advancedAnalytics')
  const logs = await VisitorLog.find({ organizationId }).sort({ createdAt: -1 }).limit(100)
  const total = await VisitorLog.countDocuments({ organizationId })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Visitor analytics fetched',
    data: {
      total,
      recentLogs: logs,
    },
  })
})

export const VisitorLogsController = {
  logVisitor,
  getVisitorAnalytics,
}
