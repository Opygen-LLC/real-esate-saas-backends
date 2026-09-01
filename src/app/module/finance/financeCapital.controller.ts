import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import type { AccountingActor } from './financeAccounting.interface'
import { FinanceCapitalService } from './financeCapital.service'

const actor = (req: Request): AccountingActor => ({ id: String(req.user?._id || req.user?.id || ''), role: req.user?.userRole || 'tenant', requestId: req.requestId, ip: req.ip, permissions: req.tenant?.permissions || [] })
const ok = (res: Response, message: string, data: unknown, statusCode = httpStatus.OK) => sendResponse(res, { statusCode, success: true, message, data })

const initialize = catchAsync(async (req: Request, res: Response) => ok(res, 'Capital accounting initialized successfully', await FinanceCapitalService.initializeCapital(requireTenant(req), actor(req))))
const listShareholders = catchAsync(async (req: Request, res: Response) => ok(res, 'Shareholders fetched successfully', await FinanceCapitalService.listShareholders(requireTenant(req))))
const createShareholder = catchAsync(async (req: Request, res: Response) => ok(res, 'Shareholder created successfully', await FinanceCapitalService.createShareholder(requireTenant(req), actor(req), req.body), httpStatus.CREATED))
const updateShareholder = catchAsync(async (req: Request, res: Response) => ok(res, 'Shareholder updated successfully', await FinanceCapitalService.updateShareholder(requireTenant(req), actor(req), req.params.id, req.body)))
const listEquityTransactions = catchAsync(async (req: Request, res: Response) => ok(res, 'Equity transactions fetched successfully', await FinanceCapitalService.listEquityTransactions(requireTenant(req), req.query)))
const createEquityTransaction = catchAsync(async (req: Request, res: Response) => ok(res, 'Equity transaction recorded successfully', await FinanceCapitalService.createEquityTransaction(requireTenant(req), actor(req), req.body), httpStatus.CREATED))
const listShareholderLoans = catchAsync(async (req: Request, res: Response) => ok(res, 'Shareholder loans fetched successfully', await FinanceCapitalService.listShareholderLoans(requireTenant(req))))
const createShareholderLoan = catchAsync(async (req: Request, res: Response) => ok(res, 'Shareholder loan received successfully', await FinanceCapitalService.createShareholderLoan(requireTenant(req), actor(req), req.body), httpStatus.CREATED))
const payShareholderLoan = catchAsync(async (req: Request, res: Response) => ok(res, 'Shareholder loan payment posted successfully', await FinanceCapitalService.payShareholderLoan(requireTenant(req), actor(req), req.params.id, req.body)))
const listDividends = catchAsync(async (req: Request, res: Response) => ok(res, 'Dividends fetched successfully', await FinanceCapitalService.listDividends(requireTenant(req))))
const createDividend = catchAsync(async (req: Request, res: Response) => ok(res, 'Dividend draft created successfully', await FinanceCapitalService.createDividend(requireTenant(req), actor(req), req.body), httpStatus.CREATED))
const approveDividend = catchAsync(async (req: Request, res: Response) => ok(res, 'Dividend approved successfully', await FinanceCapitalService.approveDividend(requireTenant(req), actor(req), req.params.id)))
const declareDividend = catchAsync(async (req: Request, res: Response) => ok(res, 'Dividend declared successfully', await FinanceCapitalService.declareDividend(requireTenant(req), actor(req), req.params.id)))
const payDividend = catchAsync(async (req: Request, res: Response) => ok(res, 'Dividend payment posted successfully', await FinanceCapitalService.payDividend(requireTenant(req), actor(req), req.params.id, req.body)))
const listLoans = catchAsync(async (req: Request, res: Response) => ok(res, 'Company loans fetched successfully', await FinanceCapitalService.listLoans(requireTenant(req))))
const createLoan = catchAsync(async (req: Request, res: Response) => ok(res, 'Company loan received successfully', await FinanceCapitalService.createLoan(requireTenant(req), actor(req), req.body), httpStatus.CREATED))
const payLoan = catchAsync(async (req: Request, res: Response) => ok(res, 'Company loan payment posted successfully', await FinanceCapitalService.payLoan(requireTenant(req), actor(req), req.params.id, req.body)))
const retainedEarnings = catchAsync(async (req: Request, res: Response) => ok(res, 'Retained earnings bridge fetched successfully', await FinanceCapitalService.retainedEarnings(requireTenant(req), req.query)))

export const FinanceCapitalController = { initialize, listShareholders, createShareholder, updateShareholder, listEquityTransactions, createEquityTransaction, listShareholderLoans, createShareholderLoan, payShareholderLoan, listDividends, createDividend, approveDividend, declareDividend, payDividend, listLoans, createLoan, payLoan, retainedEarnings }
