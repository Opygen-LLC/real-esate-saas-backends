import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { Organization } from '../organization/organization.model'
import { VisitorLog } from './visitorLogs.model'

const logVisitor = catchAsync(async (req: Request, res: Response) => {
  const { organizationId, urlPath, referrer, device, browser, os } = req.body
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress

  if (organizationId) {
    await VisitorLog.create({
      organizationId,
      ip: String(ip),
      urlPath,
      referrer,
      device,
      browser,
      os,
    })

    await Organization.findOneAndUpdate(
      { organizationId },
      { $inc: { totalVisitor: 1 } }
    )
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Visitor logged',
    data: null,
  })
})

const getVisitorAnalytics = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
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
