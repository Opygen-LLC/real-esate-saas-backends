import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import { FinanceReportingService } from './financeReporting.service'
import type { FinanceReportExportFormat, FinanceReportKey } from './financeReporting.interface'

const privateNoStore = (res: Response) => { res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Pragma', 'no-cache') }
const reportHandler = (report: FinanceReportKey) => catchAsync(async (req: Request, res: Response) => { privateNoStore(res); return sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Finance report fetched successfully', data: await FinanceReportingService.getReport(requireTenant(req), report, req.query) }) })
const drilldown = catchAsync(async (req: Request, res: Response) => { privateNoStore(res); return sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Finance report drill-down fetched successfully', data: await FinanceReportingService.drilldown(requireTenant(req), req.query) }) })
const exportReport = catchAsync(async (req: Request, res: Response) => {
  const result = await FinanceReportingService.exportReport(requireTenant(req), req.params.report as FinanceReportKey, req.query.format as FinanceReportExportFormat, req.query)
  res.setHeader('Content-Type', result.contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.status(httpStatus.OK).send(result.buffer)
})

export const FinanceReportingController = {
  trialBalance: reportHandler('trial-balance'), balanceSheet: reportHandler('balance-sheet'), profitLoss: reportHandler('profit-loss'), cashFlow: reportHandler('cash-flow'), statementOfEquity: reportHandler('statement-of-equity'),
  generalLedger: reportHandler('general-ledger'), arAging: reportHandler('ar-aging'), apAging: reportHandler('ap-aging'), propertyProfitability: reportHandler('property-profitability'), tax: reportHandler('tax'), budgetVsActual: reportHandler('budget-vs-actual'),
  drilldown, exportReport,
}
