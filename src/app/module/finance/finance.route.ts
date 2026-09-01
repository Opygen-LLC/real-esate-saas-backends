import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { FinanceController } from './finance.controller'
import { FinanceValidation } from './finance.validation'
import { FinanceAccountingSettingsController } from './financeAccountingSettings.controller'
import { FinanceAccountingSettingsValidation } from './financeAccountingSettings.validation'
import { FinanceAccountingController } from './financeAccounting.controller'
import { FinanceAccountingValidation } from './financeAccounting.validation'
import { FinanceOperationsController } from './financeOperations.controller'
import { FinanceOperationsValidation } from './financeOperations.validation'
import { financeBankStatementUpload } from './financeBankStatementUpload.middleware'
import { FinanceCapitalController } from './financeCapital.controller'
import { FinanceCapitalValidation } from './financeCapital.validation'

const router = express.Router()
const read = [authMiddlewares.auth(), authMiddlewares.requirePermission('finance.read')] as const
const write = [authMiddlewares.auth(), authMiddlewares.requirePermission('finance.write')] as const
const remove = [authMiddlewares.auth(), authMiddlewares.requirePermission('finance.delete')] as const
const advancedRead = [authMiddlewares.auth(), authMiddlewares.requirePermission('finance.read'), authMiddlewares.requireEntitlement('ADVANCED_ACCOUNTING')] as const
const advancedWrite = [authMiddlewares.auth(), authMiddlewares.requirePermission('finance.write'), authMiddlewares.requireEntitlement('ADVANCED_ACCOUNTING')] as const
const advancedDelete = [authMiddlewares.auth(), authMiddlewares.requirePermission('finance.delete'), authMiddlewares.requireEntitlement('ADVANCED_ACCOUNTING')] as const

router.get('/accounting/settings', ...advancedRead, FinanceAccountingSettingsController.get)
router.patch('/accounting/settings', ...advancedWrite, validateRequest(FinanceAccountingSettingsValidation.update), FinanceAccountingSettingsController.update)

router.post('/accounting/initialize', ...advancedWrite, validateRequest(FinanceAccountingValidation.initialize), FinanceAccountingController.initialize)

router.get('/accounting/accounts', ...advancedRead, validateRequest(FinanceAccountingValidation.listAccounts), FinanceAccountingController.listAccounts)
router.post('/accounting/accounts', ...advancedWrite, validateRequest(FinanceAccountingValidation.createAccount), FinanceAccountingController.createAccount)
router.get('/accounting/accounts/:id', ...advancedRead, validateRequest(FinanceAccountingValidation.idParam), FinanceAccountingController.getAccount)
router.patch('/accounting/accounts/:id', ...advancedWrite, validateRequest(FinanceAccountingValidation.updateAccount), FinanceAccountingController.updateAccount)
router.delete('/accounting/accounts/:id', ...advancedDelete, validateRequest(FinanceAccountingValidation.idParam), FinanceAccountingController.deleteAccount)

router.get('/accounting/fiscal-years', ...advancedRead, FinanceAccountingController.listFiscalYears)
router.post('/accounting/fiscal-years', ...advancedWrite, validateRequest(FinanceAccountingValidation.createFiscalYear), FinanceAccountingController.createFiscalYear)
router.patch('/accounting/fiscal-years/:id/status', ...advancedWrite, validateRequest(FinanceAccountingValidation.fiscalYearStatus), FinanceAccountingController.setFiscalYearStatus)
router.get('/accounting/fiscal-periods', ...advancedRead, validateRequest(FinanceAccountingValidation.listFiscalPeriods), FinanceAccountingController.listFiscalPeriods)
router.patch('/accounting/fiscal-periods/:id/status', ...advancedWrite, validateRequest(FinanceAccountingValidation.fiscalPeriodStatus), FinanceAccountingController.setFiscalPeriodStatus)

router.get('/accounting/category-mappings', ...advancedRead, FinanceAccountingController.listCategoryMappings)
router.put('/accounting/category-mappings', ...advancedWrite, validateRequest(FinanceAccountingValidation.categoryMapping), FinanceAccountingController.setCategoryMapping)

router.get('/accounting/journals', ...advancedRead, validateRequest(FinanceAccountingValidation.listJournals), FinanceAccountingController.listJournals)
router.post('/accounting/journals', ...advancedWrite, validateRequest(FinanceAccountingValidation.createJournal), FinanceAccountingController.createJournal)
router.get('/accounting/journals/:id', ...advancedRead, validateRequest(FinanceAccountingValidation.idParam), FinanceAccountingController.getJournal)
router.patch('/accounting/journals/:id', ...advancedWrite, validateRequest(FinanceAccountingValidation.updateJournal), FinanceAccountingController.updateJournal)
router.post('/accounting/journals/:id/post', ...advancedWrite, validateRequest(FinanceAccountingValidation.idParam), FinanceAccountingController.postJournal)
router.post('/accounting/journals/:id/reverse', ...advancedWrite, validateRequest(FinanceAccountingValidation.reverseJournal), FinanceAccountingController.reverseJournal)
router.delete('/accounting/journals/:id', ...advancedDelete, validateRequest(FinanceAccountingValidation.idParam), FinanceAccountingController.deleteJournal)

router.post('/accounting/opening-balances', ...advancedWrite, validateRequest(FinanceAccountingValidation.openingBalances), FinanceAccountingController.openingBalances)
router.get('/accounting/general-ledger', ...advancedRead, validateRequest(FinanceAccountingValidation.generalLedger), FinanceAccountingController.generalLedger)


// Phase 4 operational accounting
router.post('/accounting/operations/initialize', ...advancedWrite, validateRequest(FinanceOperationsValidation.initialize), FinanceOperationsController.initialize)
router.get('/accounting/receivables', ...advancedRead, validateRequest(FinanceOperationsValidation.receivables), FinanceOperationsController.receivables)
router.get('/accounting/payables', ...advancedRead, validateRequest(FinanceOperationsValidation.payables), FinanceOperationsController.payables)

router.get('/accounting/tax-codes', ...advancedRead, FinanceOperationsController.listTaxCodes)
router.post('/accounting/tax-codes', ...advancedWrite, validateRequest(FinanceOperationsValidation.createTaxCode), FinanceOperationsController.createTaxCode)
router.patch('/accounting/tax-codes/:id', ...advancedWrite, validateRequest(FinanceOperationsValidation.updateTaxCode), FinanceOperationsController.updateTaxCode)

router.get('/accounting/bank-accounts', ...advancedRead, FinanceOperationsController.listBankAccounts)
router.post('/accounting/bank-accounts', ...advancedWrite, validateRequest(FinanceOperationsValidation.createBankAccount), FinanceOperationsController.createBankAccount)
router.patch('/accounting/bank-accounts/:id', ...advancedWrite, validateRequest(FinanceOperationsValidation.updateBankAccount), FinanceOperationsController.updateBankAccount)
router.get('/accounting/bank-transfers', ...advancedRead, FinanceOperationsController.listBankTransfers)
router.post('/accounting/bank-transfers', ...advancedWrite, validateRequest(FinanceOperationsValidation.createBankTransfer), FinanceOperationsController.createBankTransfer)

router.get('/accounting/vendor-bills', ...advancedRead, validateRequest(FinanceOperationsValidation.vendorBillList), FinanceOperationsController.listVendorBills)
router.post('/accounting/vendor-bills', ...advancedWrite, validateRequest(FinanceOperationsValidation.createVendorBill), FinanceOperationsController.createVendorBill)
router.get('/accounting/vendor-bills/:id', ...advancedRead, validateRequest(FinanceOperationsValidation.vendorBillId), FinanceOperationsController.getVendorBill)
router.patch('/accounting/vendor-bills/:id', ...advancedWrite, validateRequest(FinanceOperationsValidation.updateVendorBill), FinanceOperationsController.updateVendorBill)
router.post('/accounting/vendor-bills/:id/approve', ...advancedWrite, validateRequest(FinanceOperationsValidation.vendorBillId), FinanceOperationsController.approveVendorBill)
router.post('/accounting/vendor-bills/:id/post', ...advancedWrite, validateRequest(FinanceOperationsValidation.vendorBillId), FinanceOperationsController.postVendorBill)
router.post('/accounting/vendor-bills/:id/payments', ...advancedWrite, validateRequest(FinanceOperationsValidation.payVendorBill), FinanceOperationsController.payVendorBill)
router.post('/accounting/vendor-bills/:id/void', ...advancedWrite, validateRequest(FinanceOperationsValidation.voidVendorBill), FinanceOperationsController.voidVendorBill)

router.get('/accounting/client-deposits', ...advancedRead, validateRequest(FinanceOperationsValidation.depositList), FinanceOperationsController.listDeposits)
router.post('/accounting/client-deposits', ...advancedWrite, validateRequest(FinanceOperationsValidation.createDeposit), FinanceOperationsController.createDeposit)
router.post('/accounting/client-deposits/:id/apply', ...advancedWrite, validateRequest(FinanceOperationsValidation.applyDeposit), FinanceOperationsController.applyDeposit)
router.post('/accounting/client-deposits/:id/refund', ...advancedWrite, validateRequest(FinanceOperationsValidation.refundDeposit), FinanceOperationsController.refundDeposit)

router.get('/accounting/bank-statements', ...advancedRead, validateRequest(FinanceOperationsValidation.statementList), FinanceOperationsController.listStatements)
router.post('/accounting/bank-statements/import', ...advancedWrite, financeBankStatementUpload, validateRequest(FinanceOperationsValidation.bankStatementBody), FinanceOperationsController.importStatement)
router.get('/accounting/bank-statements/:id', ...advancedRead, validateRequest(FinanceOperationsValidation.statementId), FinanceOperationsController.getStatement)
router.get('/accounting/bank-statements/:id/ledger-candidates', ...advancedRead, validateRequest(FinanceOperationsValidation.ledgerCandidates), FinanceOperationsController.ledgerCandidates)
router.post('/accounting/bank-statements/:id/lines/:lineId/match', ...advancedWrite, validateRequest(FinanceOperationsValidation.matchStatementLine), FinanceOperationsController.matchStatementLine)
router.post('/accounting/bank-statements/:id/lines/:lineId/exclude', ...advancedWrite, validateRequest(FinanceOperationsValidation.excludeStatementLine), FinanceOperationsController.excludeStatementLine)
router.post('/accounting/bank-statements/:id/reconcile', ...advancedWrite, validateRequest(FinanceOperationsValidation.statementId), FinanceOperationsController.reconcileStatement)

// Phase 5 capital structure, dividends and financing
router.post('/accounting/capital/initialize', ...advancedWrite, validateRequest(FinanceCapitalValidation.initialize), FinanceCapitalController.initialize)
router.get('/accounting/shareholders', ...advancedRead, FinanceCapitalController.listShareholders)
router.post('/accounting/shareholders', ...advancedWrite, validateRequest(FinanceCapitalValidation.createShareholder), FinanceCapitalController.createShareholder)
router.patch('/accounting/shareholders/:id', ...advancedWrite, validateRequest(FinanceCapitalValidation.updateShareholder), FinanceCapitalController.updateShareholder)
router.get('/accounting/equity-transactions', ...advancedRead, validateRequest(FinanceCapitalValidation.listEquity), FinanceCapitalController.listEquityTransactions)
router.post('/accounting/equity-transactions', ...advancedWrite, validateRequest(FinanceCapitalValidation.createEquity), FinanceCapitalController.createEquityTransaction)
router.get('/accounting/shareholder-loans', ...advancedRead, FinanceCapitalController.listShareholderLoans)
router.post('/accounting/shareholder-loans', ...advancedWrite, validateRequest(FinanceCapitalValidation.createShareholderLoan), FinanceCapitalController.createShareholderLoan)
router.post('/accounting/shareholder-loans/:id/payments', ...advancedWrite, validateRequest(FinanceCapitalValidation.payShareholderLoan), FinanceCapitalController.payShareholderLoan)
router.get('/accounting/dividends', ...advancedRead, FinanceCapitalController.listDividends)
router.post('/accounting/dividends', ...advancedWrite, validateRequest(FinanceCapitalValidation.createDividend), FinanceCapitalController.createDividend)
router.post('/accounting/dividends/:id/approve', ...advancedWrite, validateRequest(FinanceCapitalValidation.dividendId), FinanceCapitalController.approveDividend)
router.post('/accounting/dividends/:id/declare', ...advancedWrite, validateRequest(FinanceCapitalValidation.dividendId), FinanceCapitalController.declareDividend)
router.post('/accounting/dividends/:id/payments', ...advancedWrite, validateRequest(FinanceCapitalValidation.payDividend), FinanceCapitalController.payDividend)
router.get('/accounting/loans', ...advancedRead, FinanceCapitalController.listLoans)
router.post('/accounting/loans', ...advancedWrite, validateRequest(FinanceCapitalValidation.createLoan), FinanceCapitalController.createLoan)
router.post('/accounting/loans/:id/payments', ...advancedWrite, validateRequest(FinanceCapitalValidation.payLoan), FinanceCapitalController.payLoan)
router.get('/accounting/retained-earnings', ...advancedRead, validateRequest(FinanceCapitalValidation.retainedEarnings), FinanceCapitalController.retainedEarnings)

router.get('/overview', ...read, FinanceController.getOverview)
router.get('/reports', ...read, FinanceController.getReports)
router.get('/reports/transactions.csv', ...read, FinanceController.exportTransactions)

router.get('/transactions', ...read, FinanceController.listTransactions)
router.post('/transactions', ...write, validateRequest(FinanceValidation.createTransaction), FinanceController.createTransaction)
router.patch('/transactions/:id', ...write, validateRequest(FinanceValidation.updateTransaction), FinanceController.updateTransaction)
router.post('/transactions/:id/void', ...write, validateRequest(FinanceValidation.voidTransaction), FinanceController.voidTransaction)
router.delete('/transactions/:id', ...remove, validateRequest(FinanceValidation.deleteRecord), FinanceController.deleteTransaction)

router.get('/invoices', ...read, FinanceController.listInvoices)
router.post('/invoices', ...write, validateRequest(FinanceValidation.createInvoice), FinanceController.createInvoice)
router.get('/invoices/:id/pdf', ...read, FinanceController.downloadInvoicePdf)
router.post('/invoices/:id/void', ...write, validateRequest(FinanceValidation.voidInvoice), FinanceController.voidInvoice)
router.post('/invoices/:id/payments', ...write, validateRequest(FinanceValidation.recordInvoicePayment), FinanceController.recordInvoicePayment)
router.get('/invoices/:id', ...read, FinanceController.getInvoice)
router.patch('/invoices/:id', ...write, validateRequest(FinanceValidation.updateInvoice), FinanceController.updateInvoice)
router.delete('/invoices/:id', ...remove, validateRequest(FinanceValidation.archiveInvoice), FinanceController.archiveInvoice)

router.get('/commissions', ...read, FinanceController.listCommissions)
router.post('/commissions', ...write, validateRequest(FinanceValidation.createCommission), FinanceController.createCommission)
router.patch('/commissions/:id', ...write, validateRequest(FinanceValidation.updateCommission), FinanceController.updateCommission)
router.post('/commissions/:id/cancel', ...write, validateRequest(FinanceValidation.cancelCommission), FinanceController.cancelCommission)
router.post('/commissions/:id/pay', ...write, validateRequest(FinanceValidation.payCommission), FinanceController.payCommission)
router.delete('/commissions/:id', ...remove, validateRequest(FinanceValidation.deleteRecord), FinanceController.archiveCommission)

router.get('/vendors', ...read, FinanceController.listVendors)
router.post('/vendors', ...write, validateRequest(FinanceValidation.createVendor), FinanceController.createVendor)
router.patch('/vendors/:id', ...write, validateRequest(FinanceValidation.updateVendor), FinanceController.updateVendor)
router.delete('/vendors/:id', ...remove, validateRequest(FinanceValidation.deleteRecord), FinanceController.archiveVendor)

router.get('/budgets', ...read, FinanceController.listBudgets)
router.post('/budgets', ...write, validateRequest(FinanceValidation.createBudget), FinanceController.createBudget)
router.patch('/budgets/:id', ...write, validateRequest(FinanceValidation.updateBudget), FinanceController.updateBudget)
router.delete('/budgets/:id', ...remove, validateRequest(FinanceValidation.deleteRecord), FinanceController.archiveBudget)

export const FinanceRoute = router
