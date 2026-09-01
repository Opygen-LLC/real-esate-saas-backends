import { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import type { AccountingActor } from './financeAccounting.interface'
import { FinanceAccountingService } from './financeAccounting.service'
import { FinanceCategoryMappingService } from './financeCategoryMapping.service'

const actor = (req: Request): AccountingActor => ({
  id: String(req.user?._id || req.user?.id || ''),
  role: req.user?.userRole || 'tenant',
  requestId: req.requestId,
  ip: req.ip,
  permissions: req.tenant?.permissions || [],
})

const initialize = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Accounting initialized successfully', data: await FinanceAccountingService.initialize(requireTenant(req), actor(req)) }))
const listAccounts = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Chart of Accounts fetched successfully', data: await FinanceAccountingService.listAccounts(requireTenant(req), req.query) }))
const getAccount = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Finance account fetched successfully', data: await FinanceAccountingService.getAccount(requireTenant(req), req.params.id) }))
const createAccount = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Finance account created successfully', data: await FinanceAccountingService.createAccount(requireTenant(req), actor(req), req.body) }))
const updateAccount = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Finance account updated successfully', data: await FinanceAccountingService.updateAccount(requireTenant(req), actor(req), req.params.id, req.body) }))
const deleteAccount = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Finance account deleted successfully', data: await FinanceAccountingService.deleteAccount(requireTenant(req), actor(req), req.params.id) }))

const listFiscalYears = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Fiscal years fetched successfully', data: await FinanceAccountingService.listFiscalYears(requireTenant(req)) }))
const createFiscalYear = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Fiscal year created successfully', data: await FinanceAccountingService.createFiscalYear(requireTenant(req), actor(req), req.body) }))
const setFiscalYearStatus = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Fiscal year status updated successfully', data: await FinanceAccountingService.setFiscalYearStatus(requireTenant(req), actor(req), req.params.id, req.body.status) }))
const listFiscalPeriods = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Fiscal periods fetched successfully', data: await FinanceAccountingService.listFiscalPeriods(requireTenant(req), req.query.fiscalYearId as string | undefined) }))
const setFiscalPeriodStatus = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Fiscal period status updated successfully', data: await FinanceAccountingService.setFiscalPeriodStatus(requireTenant(req), actor(req), req.params.id, req.body.status) }))


const listCategoryMappings = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Finance category mappings fetched successfully', data: await FinanceCategoryMappingService.list(requireTenant(req)) }))
const setCategoryMapping = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Finance category mapping updated successfully', data: await FinanceCategoryMappingService.setMapping(requireTenant(req), actor(req), req.body) }))

const listJournals = catchAsync(async (req: Request, res: Response) => {
  const result = await FinanceAccountingService.listJournals(requireTenant(req), req.query)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Journal entries fetched successfully', data: result.data, meta: result.meta })
})
const getJournal = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Journal entry fetched successfully', data: await FinanceAccountingService.getJournal(requireTenant(req), req.params.id) }))
const createJournal = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Journal draft created successfully', data: await FinanceAccountingService.createManualJournal(requireTenant(req), actor(req), req.body) }))
const updateJournal = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Journal draft updated successfully', data: await FinanceAccountingService.updateDraftJournal(requireTenant(req), actor(req), req.params.id, req.body) }))
const postJournal = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Journal posted successfully', data: await FinanceAccountingService.postJournal(requireTenant(req), actor(req), req.params.id) }))
const reverseJournal = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Journal reversed successfully', data: await FinanceAccountingService.reverseJournal(requireTenant(req), actor(req), req.params.id, req.body) }))
const deleteJournal = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Draft journal deleted successfully', data: await FinanceAccountingService.deleteDraftJournal(requireTenant(req), actor(req), req.params.id) }))
const openingBalances = catchAsync(async (req: Request, res: Response) => sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Opening balances posted successfully', data: await FinanceAccountingService.createOpeningBalances(requireTenant(req), actor(req), req.body) }))
const generalLedger = catchAsync(async (req: Request, res: Response) => {
  const result = await FinanceAccountingService.getGeneralLedger(requireTenant(req), req.query)
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'General Ledger fetched successfully', data: result.data, meta: { ...result.meta, summary: result.summary } as any })
})

export const FinanceAccountingController = {
  initialize,
  listAccounts, getAccount, createAccount, updateAccount, deleteAccount,
  listFiscalYears, createFiscalYear, setFiscalYearStatus, listFiscalPeriods, setFiscalPeriodStatus,
  listCategoryMappings, setCategoryMapping,
  listJournals, getJournal, createJournal, updateJournal, postJournal, reverseJournal, deleteJournal,
  openingBalances,
  generalLedger,
}
