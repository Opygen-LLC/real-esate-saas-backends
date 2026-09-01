import type { Request, Response } from 'express'
import httpStatus from 'http-status'
import catchAsync from '../../../shared/catchAsync'
import { sendResponse } from '../../../shared/customResponse'
import { requireTenant } from '../../middlewares/auth'
import type { AccountingActor } from './financeAccounting.interface'
import { FinanceOperationsService } from './financeOperations.service'

const actor = (req: Request): AccountingActor => ({ id: String(req.user?._id || req.user?.id || ''), role: req.user?.userRole || 'tenant', requestId: req.requestId, ip: req.ip, permissions: req.tenant?.permissions || [] })
const ok = (res: Response, message: string, data: unknown, statusCode = httpStatus.OK) => sendResponse(res, { statusCode, success: true, message, data })

const initialize = catchAsync(async (req: Request, res: Response) => ok(res, 'Operational accounting initialized successfully', await FinanceOperationsService.initializeOperations(requireTenant(req), actor(req))))
const receivables = catchAsync(async (req: Request, res: Response) => ok(res, 'Accounts Receivable fetched successfully', await FinanceOperationsService.receivables(requireTenant(req), req.query)))
const payables = catchAsync(async (req: Request, res: Response) => ok(res, 'Accounts Payable fetched successfully', await FinanceOperationsService.payables(requireTenant(req), req.query)))

const listTaxCodes = catchAsync(async (req: Request, res: Response) => ok(res, 'Tax codes fetched successfully', await FinanceOperationsService.listTaxCodes(requireTenant(req))))
const createTaxCode = catchAsync(async (req: Request, res: Response) => ok(res, 'Tax code created successfully', await FinanceOperationsService.createTaxCode(requireTenant(req), actor(req), req.body), httpStatus.CREATED))
const updateTaxCode = catchAsync(async (req: Request, res: Response) => ok(res, 'Tax code updated successfully', await FinanceOperationsService.updateTaxCode(requireTenant(req), actor(req), req.params.id, req.body)))

const listBankAccounts = catchAsync(async (req: Request, res: Response) => ok(res, 'Bank accounts fetched successfully', await FinanceOperationsService.listBankAccounts(requireTenant(req))))
const createBankAccount = catchAsync(async (req: Request, res: Response) => ok(res, 'Bank account created successfully', await FinanceOperationsService.createBankAccount(requireTenant(req), actor(req), req.body), httpStatus.CREATED))
const updateBankAccount = catchAsync(async (req: Request, res: Response) => ok(res, 'Bank account updated successfully', await FinanceOperationsService.updateBankAccount(requireTenant(req), actor(req), req.params.id, req.body)))
const listBankTransfers = catchAsync(async (req: Request, res: Response) => ok(res, 'Bank transfers fetched successfully', await FinanceOperationsService.listBankTransfers(requireTenant(req))))
const createBankTransfer = catchAsync(async (req: Request, res: Response) => ok(res, 'Bank transfer posted successfully', await FinanceOperationsService.transferBankFunds(requireTenant(req), actor(req), req.body), httpStatus.CREATED))

const listVendorBills = catchAsync(async (req: Request, res: Response) => ok(res, 'Vendor bills fetched successfully', await FinanceOperationsService.listVendorBills(requireTenant(req), req.query)))
const getVendorBill = catchAsync(async (req: Request, res: Response) => ok(res, 'Vendor bill fetched successfully', await FinanceOperationsService.getVendorBill(requireTenant(req), req.params.id)))
const createVendorBill = catchAsync(async (req: Request, res: Response) => ok(res, 'Vendor bill created successfully', await FinanceOperationsService.createVendorBill(requireTenant(req), actor(req), req.body), httpStatus.CREATED))
const updateVendorBill = catchAsync(async (req: Request, res: Response) => ok(res, 'Vendor bill updated successfully', await FinanceOperationsService.updateVendorBill(requireTenant(req), actor(req), req.params.id, req.body)))
const approveVendorBill = catchAsync(async (req: Request, res: Response) => ok(res, 'Vendor bill approved successfully', await FinanceOperationsService.approveVendorBill(requireTenant(req), actor(req), req.params.id)))
const postVendorBill = catchAsync(async (req: Request, res: Response) => ok(res, 'Vendor bill posted successfully', await FinanceOperationsService.postVendorBill(requireTenant(req), actor(req), req.params.id)))
const payVendorBill = catchAsync(async (req: Request, res: Response) => ok(res, 'Vendor bill payment posted successfully', await FinanceOperationsService.payVendorBill(requireTenant(req), actor(req), req.params.id, req.body)))
const voidVendorBill = catchAsync(async (req: Request, res: Response) => ok(res, 'Vendor bill voided successfully', await FinanceOperationsService.voidVendorBill(requireTenant(req), actor(req), req.params.id, req.body.reason)))

const listDeposits = catchAsync(async (req: Request, res: Response) => ok(res, 'Client deposits fetched successfully', await FinanceOperationsService.listClientDeposits(requireTenant(req), req.query)))
const createDeposit = catchAsync(async (req: Request, res: Response) => ok(res, 'Client deposit received successfully', await FinanceOperationsService.createClientDeposit(requireTenant(req), actor(req), req.body), httpStatus.CREATED))
const applyDeposit = catchAsync(async (req: Request, res: Response) => ok(res, 'Client deposit applied successfully', await FinanceOperationsService.applyClientDeposit(requireTenant(req), actor(req), req.params.id, req.body)))
const refundDeposit = catchAsync(async (req: Request, res: Response) => ok(res, 'Client deposit refunded successfully', await FinanceOperationsService.refundClientDeposit(requireTenant(req), actor(req), req.params.id, req.body)))

const listStatements = catchAsync(async (req: Request, res: Response) => ok(res, 'Bank statements fetched successfully', await FinanceOperationsService.listBankStatements(requireTenant(req), req.query)))
const getStatement = catchAsync(async (req: Request, res: Response) => ok(res, 'Bank statement fetched successfully', await FinanceOperationsService.getBankStatement(requireTenant(req), req.params.id)))
const importStatement = catchAsync(async (req: Request, res: Response) => ok(res, 'Bank statement imported successfully', await FinanceOperationsService.createBankStatement(requireTenant(req), actor(req), req.body, req.file!), httpStatus.CREATED))
const ledgerCandidates = catchAsync(async (req: Request, res: Response) => ok(res, 'Ledger matching candidates fetched successfully', await FinanceOperationsService.ledgerCandidates(requireTenant(req), req.params.id, req.query)))
const matchStatementLine = catchAsync(async (req: Request, res: Response) => ok(res, 'Bank statement line matched successfully', await FinanceOperationsService.matchStatementLine(requireTenant(req), actor(req), req.params.id, req.params.lineId, req.body)))
const excludeStatementLine = catchAsync(async (req: Request, res: Response) => ok(res, 'Bank statement line excluded successfully', await FinanceOperationsService.excludeStatementLine(requireTenant(req), actor(req), req.params.id, req.params.lineId, req.body.reason)))
const reconcileStatement = catchAsync(async (req: Request, res: Response) => ok(res, 'Bank statement reconciled successfully', await FinanceOperationsService.reconcileBankStatement(requireTenant(req), actor(req), req.params.id)))

export const FinanceOperationsController = {
  initialize, receivables, payables,
  listTaxCodes, createTaxCode, updateTaxCode,
  listBankAccounts, createBankAccount, updateBankAccount, listBankTransfers, createBankTransfer,
  listVendorBills, getVendorBill, createVendorBill, updateVendorBill, approveVendorBill, postVendorBill, payVendorBill, voidVendorBill,
  listDeposits, createDeposit, applyDeposit, refundDeposit,
  listStatements, getStatement, importStatement, ledgerCandidates, matchStatementLine, excludeStatementLine, reconcileStatement,
}
