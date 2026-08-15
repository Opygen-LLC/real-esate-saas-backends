import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import pick from '../../../shared/pick'
import { requireTenant } from '../../middlewares/auth'
import { FinanceService } from './finance.service'

const actorId = (req: Request) => req.user?._id || req.user?.id || ''
const financeActor = (req: Request) => ({ id: actorId(req), role: req.user?.userRole || 'tenant', requestId: req.requestId, ip: req.ip })
const pagination = (req: Request) => pick(req.query, ['page', 'limit', 'sortBy', 'sortOrder'])

const getOverview = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.getOverview(requireTenant(req), req.query)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Finance overview fetched successfully', data })
})
const getReports = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.getReports(requireTenant(req), req.query)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Finance reports fetched successfully', data })
})
const exportTransactions = catchAsync(async (req: Request, res: Response) => {
  const csv = await FinanceService.exportTransactionsCsv(requireTenant(req), req.query)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="finance-transactions-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.status(httpStatus.OK).send(csv)
})

const listTransactions = catchAsync(async (req: Request, res: Response) => {
  const result = await FinanceService.listTransactions(requireTenant(req), req.query, pagination(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Transactions fetched successfully', meta: result.meta, data: result.data })
})
const createTransaction = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.createTransaction(requireTenant(req), actorId(req), req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Transaction created successfully', data })
})
const updateTransaction = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.updateTransaction(requireTenant(req), actorId(req), req.params.id, req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Transaction updated successfully', data })
})
const voidTransaction = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.voidTransaction(requireTenant(req), actorId(req), req.params.id, req.body.reason)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Transaction voided successfully', data })
})

const listInvoices = catchAsync(async (req: Request, res: Response) => {
  const result = await FinanceService.listInvoices(requireTenant(req), req.query, pagination(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Invoices fetched successfully', meta: result.meta, data: result.data })
})
const createInvoice = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.createInvoice(requireTenant(req), financeActor(req), req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Invoice created successfully', data })
})
const getInvoice = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.getInvoiceById(requireTenant(req), req.params.id)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Invoice fetched successfully', data })
})
const updateInvoice = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.updateInvoice(requireTenant(req), financeActor(req), req.params.id, req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Invoice updated successfully', data })
})
const recordInvoicePayment = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.recordInvoicePayment(requireTenant(req), financeActor(req), req.params.id, req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Invoice payment recorded successfully', data })
})
const voidInvoice = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.voidInvoice(requireTenant(req), financeActor(req), req.params.id, req.body.reason)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Invoice voided successfully', data })
})
const archiveInvoice = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.archiveDraftInvoice(requireTenant(req), financeActor(req), req.params.id, req.body?.reason)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Draft invoice archived successfully', data })
})
const downloadInvoicePdf = catchAsync(async (req: Request, res: Response) => {
  const result = await FinanceService.renderInvoiceDocument(requireTenant(req), financeActor(req), req.params.id)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.status(httpStatus.OK).send(result.pdf)
})

const listCommissions = catchAsync(async (req: Request, res: Response) => {
  const result = await FinanceService.listCommissions(requireTenant(req), req.query, pagination(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Commissions fetched successfully', meta: result.meta, data: result.data })
})
const createCommission = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.createCommission(requireTenant(req), actorId(req), req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Commission created successfully', data })
})
const updateCommission = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.updateCommission(requireTenant(req), actorId(req), req.params.id, req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Commission updated successfully', data })
})
const payCommission = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.payCommission(requireTenant(req), actorId(req), req.params.id, req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Commission marked as paid', data })
})

const listVendors = catchAsync(async (req: Request, res: Response) => {
  const result = await FinanceService.listVendors(requireTenant(req), req.query, pagination(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Vendors fetched successfully', meta: result.meta, data: result.data })
})
const createVendor = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.createVendor(requireTenant(req), actorId(req), req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Vendor created successfully', data })
})
const updateVendor = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.updateVendor(requireTenant(req), actorId(req), req.params.id, req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Vendor updated successfully', data })
})
const archiveVendor = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.archiveVendor(requireTenant(req), actorId(req), req.params.id)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Vendor archived successfully', data })
})

const listBudgets = catchAsync(async (req: Request, res: Response) => {
  const result = await FinanceService.listBudgets(requireTenant(req), req.query, pagination(req))
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Budgets fetched successfully', meta: result.meta, data: result.data })
})
const createBudget = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.createBudget(requireTenant(req), actorId(req), req.body)
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Budget created successfully', data })
})
const updateBudget = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.updateBudget(requireTenant(req), actorId(req), req.params.id, req.body)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Budget updated successfully', data })
})
const archiveBudget = catchAsync(async (req: Request, res: Response) => {
  const data = await FinanceService.archiveBudget(requireTenant(req), actorId(req), req.params.id)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Budget archived successfully', data })
})

export const FinanceController = {
  getOverview, getReports, exportTransactions,
  listTransactions, createTransaction, updateTransaction, voidTransaction,
  listInvoices, createInvoice, getInvoice, updateInvoice, voidInvoice, archiveInvoice, recordInvoicePayment, downloadInvoicePdf,
  listCommissions, createCommission, updateCommission, payCommission,
  listVendors, createVendor, updateVendor, archiveVendor,
  listBudgets, createBudget, updateBudget, archiveBudget,
}
