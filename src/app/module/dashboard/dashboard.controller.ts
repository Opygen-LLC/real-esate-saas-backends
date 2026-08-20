import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { DashboardService } from './dashboard.service'
import { crmAccessFromRequest } from '../crm/crmAccess'

const getOverviewStats = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const stats = await DashboardService.getOverviewStats(organizationId)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Overview stats fetched successfully',
    data: stats,
  })
})

const getAnalytics = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const range = (req.query.range as string) || '30d'
  const analytics = await DashboardService.getAnalytics(organizationId, range)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Analytics suite data fetched successfully',
    data: analytics,
  })
})


const getBrokerPerformance = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const range = (req.query.range as string) || '30d'
  const result = await DashboardService.getBrokerPerformance(organizationId, range, req.query)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Broker performance fetched successfully', data: result.data, meta: result.meta })
})

const exportBrokerPerformanceCsv = catchAsync(async (req: Request, res: Response) => {
  const organizationId = (req.user?.organizationId || req.user?.storeId) as string
  const range = (req.query.range as string) || '30d'
  const csv = await DashboardService.exportBrokerPerformanceCsv(organizationId, range)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="broker-performance-${range}.csv"`)
  res.status(httpStatus.OK).send(`\uFEFF${csv}`)
})

const globalSearch = catchAsync(async (req: Request, res: Response) => {
  const organizationId = req.tenant?.organizationId || (req.user?.organizationId as string)
  const data = await DashboardService.globalSearch(organizationId, String(req.query.q || ''), crmAccessFromRequest(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Dashboard search results fetched', data })
})

const getSuperAdminOverviewStats = catchAsync(async (req: Request, res: Response) => {
  const stats = await DashboardService.getSuperAdminOverviewStats()

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Super-admin platform overview stats fetched successfully',
    data: stats,
  })
})

export const DashboardController = {
  getOverviewStats,
  getAnalytics,
  getBrokerPerformance,
  exportBrokerPerformanceCsv,
  getSuperAdminOverviewStats,
  globalSearch,
}
