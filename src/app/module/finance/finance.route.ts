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
import { FinanceReportingController } from './financeReporting.controller'
import { FinanceReportingValidation } from './financeReporting.validation'
import { FinanceInitializationController } from './financeInitialization.controller'
import { FinanceInitializationValidation } from './financeInitialization.validation'
import { FinanceCloseController } from './financeClose.controller'
import { FinanceCloseValidation } from './financeClose.validation'
import type { FinancePermission } from './finance.contract'

const router = express.Router()
const read = [authMiddlewares.auth(), authMiddlewares.requirePermission('finance.read')] as const
const write = [authMiddlewares.auth(), authMiddlewares.requirePermission('finance.write'), authMiddlewares.rejectAccountingMigrationLock] as const
const remove = [authMiddlewares.auth(), authMiddlewares.requirePermission('finance.delete'), authMiddlewares.rejectAccountingMigrationLock] as const
const advancedRead = (permission: FinancePermission = 'finance.accounting.read') => [authMiddlewares.auth(), authMiddlewares.requirePermission(permission), authMiddlewares.requireAdvancedAccountingReadAccess] as const
const advancedWrite = (permission: FinancePermission) => [authMiddlewares.auth(), authMiddlewares.requirePermission(permission), authMiddlewares.requireEntitlement('ADVANCED_ACCOUNTING')] as const

router.get('/accounting/settings', ...advancedRead(), FinanceAccountingSettingsController.get)
router.patch('/accounting/settings', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceAccountingSettingsValidation.update), FinanceAccountingSettingsController.update)

router.post('/accounting/initialize', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceAccountingValidation.initialize), FinanceAccountingController.initialize)

router.get('/accounting/accounts', ...advancedRead(), validateRequest(FinanceAccountingValidation.listAccounts), FinanceAccountingController.listAccounts)
router.post('/accounting/accounts', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceAccountingValidation.createAccount), FinanceAccountingController.createAccount)
router.get('/accounting/accounts/:id', ...advancedRead(), validateRequest(FinanceAccountingValidation.idParam), FinanceAccountingController.getAccount)
router.patch('/accounting/accounts/:id', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceAccountingValidation.updateAccount), FinanceAccountingController.updateAccount)
router.delete('/accounting/accounts/:id', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceAccountingValidation.idParam), FinanceAccountingController.deleteAccount)

router.get('/accounting/fiscal-years', ...advancedRead(), FinanceAccountingController.listFiscalYears)
router.post('/accounting/fiscal-years', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceAccountingValidation.createFiscalYear), FinanceAccountingController.createFiscalYear)
router.patch('/accounting/fiscal-years/:id/status', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceAccountingValidation.fiscalYearStatus), FinanceAccountingController.setFiscalYearStatus)
router.get('/accounting/fiscal-periods', ...advancedRead(), validateRequest(FinanceAccountingValidation.listFiscalPeriods), FinanceAccountingController.listFiscalPeriods)
router.patch('/accounting/fiscal-periods/:id/status', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceAccountingValidation.fiscalPeriodStatus), FinanceAccountingController.setFiscalPeriodStatus)

router.get('/accounting/category-mappings', ...advancedRead(), FinanceAccountingController.listCategoryMappings)
router.put('/accounting/category-mappings', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceAccountingValidation.categoryMapping), FinanceAccountingController.setCategoryMapping)

router.get('/accounting/journals', ...advancedRead(), validateRequest(FinanceAccountingValidation.listJournals), FinanceAccountingController.listJournals)
router.post('/accounting/journals', ...advancedWrite('finance.journal.create'), validateRequest(FinanceAccountingValidation.createJournal), FinanceAccountingController.createJournal)
router.get('/accounting/journals/:id', ...advancedRead(), validateRequest(FinanceAccountingValidation.idParam), FinanceAccountingController.getJournal)
router.patch('/accounting/journals/:id', ...advancedWrite('finance.journal.create'), validateRequest(FinanceAccountingValidation.updateJournal), FinanceAccountingController.updateJournal)
router.post('/accounting/journals/:id/post', ...advancedWrite('finance.journal.post'), validateRequest(FinanceAccountingValidation.idParam), FinanceAccountingController.postJournal)
router.post('/accounting/journals/:id/reverse', ...advancedWrite('finance.journal.reverse'), validateRequest(FinanceAccountingValidation.reverseJournal), FinanceAccountingController.reverseJournal)
router.delete('/accounting/journals/:id', ...advancedWrite('finance.journal.create'), validateRequest(FinanceAccountingValidation.idParam), FinanceAccountingController.deleteJournal)

router.post('/accounting/opening-balances', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceAccountingValidation.openingBalances), FinanceAccountingController.openingBalances)
router.get('/accounting/general-ledger', ...advancedRead(), validateRequest(FinanceAccountingValidation.generalLedger), FinanceAccountingController.generalLedger)

// Phase 7 migration, maker-checker, closing and immutable audit trail
router.post('/accounting/journals/:id/approve', ...advancedWrite('finance.journal.approve'), validateRequest(FinanceAccountingValidation.idParam), FinanceAccountingController.approveJournal)
router.get('/accounting/initialization/status', ...advancedRead(), FinanceInitializationController.status)
router.get('/accounting/initialization/preview', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceInitializationValidation.preview), FinanceInitializationController.preview)
router.get('/accounting/initialization/payment-method-mappings', ...advancedRead(), FinanceInitializationController.mappings)
router.put('/accounting/initialization/payment-method-mappings', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceInitializationValidation.paymentMapping), FinanceInitializationController.setMapping)
router.post('/accounting/initialization/activate', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceInitializationValidation.activate), FinanceInitializationController.activate)
router.get('/accounting/fiscal-periods/:id/close-checklist', ...advancedRead('finance.period.close'), validateRequest(FinanceCloseValidation.id), FinanceCloseController.checklist)
router.post('/accounting/fiscal-periods/:id/close', ...advancedWrite('finance.period.close'), validateRequest(FinanceCloseValidation.close), FinanceCloseController.closePeriod)
router.post('/accounting/fiscal-periods/:id/reopen', ...advancedWrite('finance.period.reopen'), validateRequest(FinanceCloseValidation.reopen), FinanceCloseController.reopenPeriod)
router.post('/accounting/fiscal-years/:id/year-end-close', ...advancedWrite('finance.period.close'), validateRequest(FinanceCloseValidation.close), FinanceCloseController.closeFiscalYear)
router.get('/accounting/audit', ...advancedRead('finance.audit.read'), validateRequest(FinanceCloseValidation.audit), FinanceCloseController.auditLog)

// Phase 6 GL financial statements and advanced reporting
router.get('/accounting/reports/trial-balance', ...advancedRead('finance.reports.read'), validateRequest(FinanceReportingValidation.common), FinanceReportingController.trialBalance)
router.get('/accounting/reports/balance-sheet', ...advancedRead('finance.reports.read'), validateRequest(FinanceReportingValidation.common), FinanceReportingController.balanceSheet)
router.get('/accounting/reports/profit-loss', ...advancedRead('finance.reports.read'), validateRequest(FinanceReportingValidation.common), FinanceReportingController.profitLoss)
router.get('/accounting/reports/cash-flow', ...advancedRead('finance.reports.read'), validateRequest(FinanceReportingValidation.common), FinanceReportingController.cashFlow)
router.get('/accounting/reports/statement-of-equity', ...advancedRead('finance.reports.read'), validateRequest(FinanceReportingValidation.common), FinanceReportingController.statementOfEquity)
router.get('/accounting/reports/general-ledger', ...advancedRead('finance.reports.read'), validateRequest(FinanceReportingValidation.common), FinanceReportingController.generalLedger)
router.get('/accounting/reports/ar-aging', ...advancedRead('finance.reports.read'), validateRequest(FinanceReportingValidation.common), FinanceReportingController.arAging)
router.get('/accounting/reports/ap-aging', ...advancedRead('finance.reports.read'), validateRequest(FinanceReportingValidation.common), FinanceReportingController.apAging)
router.get('/accounting/reports/property-profitability', ...advancedRead('finance.reports.read'), validateRequest(FinanceReportingValidation.common), FinanceReportingController.propertyProfitability)
router.get('/accounting/reports/tax', ...advancedRead('finance.reports.read'), validateRequest(FinanceReportingValidation.common), FinanceReportingController.tax)
router.get('/accounting/reports/budget-vs-actual', ...advancedRead('finance.reports.read'), validateRequest(FinanceReportingValidation.common), FinanceReportingController.budgetVsActual)
router.get('/accounting/reports/drilldown', ...advancedRead('finance.reports.read'), validateRequest(FinanceReportingValidation.drilldown), FinanceReportingController.drilldown)
router.get('/accounting/reports/export/:report', ...advancedRead('finance.reports.export'), validateRequest(FinanceReportingValidation.export), FinanceReportingController.exportReport)


// Phase 4 operational accounting
router.post('/accounting/operations/initialize', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceOperationsValidation.initialize), FinanceOperationsController.initialize)
router.get('/accounting/receivables', ...advancedRead('finance.accounting.read'), validateRequest(FinanceOperationsValidation.receivables), FinanceOperationsController.receivables)
router.get('/accounting/payables', ...advancedRead('finance.accounting.read'), validateRequest(FinanceOperationsValidation.payables), FinanceOperationsController.payables)

router.get('/accounting/tax-codes', ...advancedRead(), FinanceOperationsController.listTaxCodes)
router.post('/accounting/tax-codes', ...advancedWrite('finance.tax.manage'), validateRequest(FinanceOperationsValidation.createTaxCode), FinanceOperationsController.createTaxCode)
router.patch('/accounting/tax-codes/:id', ...advancedWrite('finance.tax.manage'), validateRequest(FinanceOperationsValidation.updateTaxCode), FinanceOperationsController.updateTaxCode)

router.get('/accounting/bank-accounts', ...advancedRead(), FinanceOperationsController.listBankAccounts)
router.post('/accounting/bank-accounts', ...advancedWrite('finance.bank.manage'), validateRequest(FinanceOperationsValidation.createBankAccount), FinanceOperationsController.createBankAccount)
router.patch('/accounting/bank-accounts/:id', ...advancedWrite('finance.bank.manage'), validateRequest(FinanceOperationsValidation.updateBankAccount), FinanceOperationsController.updateBankAccount)
router.get('/accounting/bank-transfers', ...advancedRead(), FinanceOperationsController.listBankTransfers)
router.post('/accounting/bank-transfers', ...advancedWrite('finance.bank.manage'), validateRequest(FinanceOperationsValidation.createBankTransfer), FinanceOperationsController.createBankTransfer)

router.get('/accounting/vendor-bills', ...advancedRead(), validateRequest(FinanceOperationsValidation.vendorBillList), FinanceOperationsController.listVendorBills)
router.post('/accounting/vendor-bills', ...advancedWrite('finance.payables.manage'), validateRequest(FinanceOperationsValidation.createVendorBill), FinanceOperationsController.createVendorBill)
router.get('/accounting/vendor-bills/:id', ...advancedRead(), validateRequest(FinanceOperationsValidation.vendorBillId), FinanceOperationsController.getVendorBill)
router.patch('/accounting/vendor-bills/:id', ...advancedWrite('finance.payables.manage'), validateRequest(FinanceOperationsValidation.updateVendorBill), FinanceOperationsController.updateVendorBill)
router.post('/accounting/vendor-bills/:id/approve', ...advancedWrite('finance.payables.manage'), validateRequest(FinanceOperationsValidation.vendorBillId), FinanceOperationsController.approveVendorBill)
router.post('/accounting/vendor-bills/:id/post', ...advancedWrite('finance.payables.manage'), validateRequest(FinanceOperationsValidation.vendorBillId), FinanceOperationsController.postVendorBill)
router.post('/accounting/vendor-bills/:id/payments', ...advancedWrite('finance.payables.manage'), validateRequest(FinanceOperationsValidation.payVendorBill), FinanceOperationsController.payVendorBill)
router.post('/accounting/vendor-bills/:id/void', ...advancedWrite('finance.payables.manage'), validateRequest(FinanceOperationsValidation.voidVendorBill), FinanceOperationsController.voidVendorBill)

router.get('/accounting/client-deposits', ...advancedRead(), validateRequest(FinanceOperationsValidation.depositList), FinanceOperationsController.listDeposits)
router.post('/accounting/client-deposits', ...advancedWrite('finance.receivables.manage'), validateRequest(FinanceOperationsValidation.createDeposit), FinanceOperationsController.createDeposit)
router.post('/accounting/client-deposits/:id/apply', ...advancedWrite('finance.receivables.manage'), validateRequest(FinanceOperationsValidation.applyDeposit), FinanceOperationsController.applyDeposit)
router.post('/accounting/client-deposits/:id/refund', ...advancedWrite('finance.receivables.manage'), validateRequest(FinanceOperationsValidation.refundDeposit), FinanceOperationsController.refundDeposit)

router.get('/accounting/bank-statements', ...advancedRead(), validateRequest(FinanceOperationsValidation.statementList), FinanceOperationsController.listStatements)
router.post('/accounting/bank-statements/import', ...advancedWrite('finance.bank.reconcile'), financeBankStatementUpload, validateRequest(FinanceOperationsValidation.bankStatementBody), FinanceOperationsController.importStatement)
router.get('/accounting/bank-statements/:id', ...advancedRead(), validateRequest(FinanceOperationsValidation.statementId), FinanceOperationsController.getStatement)
router.get('/accounting/bank-statements/:id/ledger-candidates', ...advancedRead(), validateRequest(FinanceOperationsValidation.ledgerCandidates), FinanceOperationsController.ledgerCandidates)
router.post('/accounting/bank-statements/:id/lines/:lineId/match', ...advancedWrite('finance.bank.reconcile'), validateRequest(FinanceOperationsValidation.matchStatementLine), FinanceOperationsController.matchStatementLine)
router.post('/accounting/bank-statements/:id/lines/:lineId/exclude', ...advancedWrite('finance.bank.reconcile'), validateRequest(FinanceOperationsValidation.excludeStatementLine), FinanceOperationsController.excludeStatementLine)
router.post('/accounting/bank-statements/:id/reconcile', ...advancedWrite('finance.bank.reconcile'), validateRequest(FinanceOperationsValidation.statementId), FinanceOperationsController.reconcileStatement)

// Phase 5 capital structure, dividends and financing
router.post('/accounting/capital/initialize', ...advancedWrite('finance.accounts.manage'), validateRequest(FinanceCapitalValidation.initialize), FinanceCapitalController.initialize)
router.get('/accounting/shareholders', ...advancedRead('finance.shareholders.read'), FinanceCapitalController.listShareholders)
router.post('/accounting/shareholders', ...advancedWrite('finance.shareholders.manage'), validateRequest(FinanceCapitalValidation.createShareholder), FinanceCapitalController.createShareholder)
router.patch('/accounting/shareholders/:id', ...advancedWrite('finance.shareholders.manage'), validateRequest(FinanceCapitalValidation.updateShareholder), FinanceCapitalController.updateShareholder)
router.get('/accounting/equity-transactions', ...advancedRead(), validateRequest(FinanceCapitalValidation.listEquity), FinanceCapitalController.listEquityTransactions)
router.post('/accounting/equity-transactions', ...advancedWrite('finance.shareholders.manage'), validateRequest(FinanceCapitalValidation.createEquity), FinanceCapitalController.createEquityTransaction)
router.get('/accounting/shareholder-loans', ...advancedRead(), FinanceCapitalController.listShareholderLoans)
router.post('/accounting/shareholder-loans', ...advancedWrite('finance.loans.manage'), validateRequest(FinanceCapitalValidation.createShareholderLoan), FinanceCapitalController.createShareholderLoan)
router.post('/accounting/shareholder-loans/:id/payments', ...advancedWrite('finance.loans.manage'), validateRequest(FinanceCapitalValidation.payShareholderLoan), FinanceCapitalController.payShareholderLoan)
router.get('/accounting/dividends', ...advancedRead(), FinanceCapitalController.listDividends)
router.post('/accounting/dividends', ...advancedWrite('finance.shareholders.manage'), validateRequest(FinanceCapitalValidation.createDividend), FinanceCapitalController.createDividend)
router.post('/accounting/dividends/:id/approve', ...advancedWrite('finance.shareholders.manage'), validateRequest(FinanceCapitalValidation.dividendId), FinanceCapitalController.approveDividend)
router.post('/accounting/dividends/:id/declare', ...advancedWrite('finance.shareholders.manage'), validateRequest(FinanceCapitalValidation.dividendId), FinanceCapitalController.declareDividend)
router.post('/accounting/dividends/:id/payments', ...advancedWrite('finance.shareholders.manage'), validateRequest(FinanceCapitalValidation.payDividend), FinanceCapitalController.payDividend)
router.get('/accounting/loans', ...advancedRead(), FinanceCapitalController.listLoans)
router.post('/accounting/loans', ...advancedWrite('finance.loans.manage'), validateRequest(FinanceCapitalValidation.createLoan), FinanceCapitalController.createLoan)
router.post('/accounting/loans/:id/payments', ...advancedWrite('finance.loans.manage'), validateRequest(FinanceCapitalValidation.payLoan), FinanceCapitalController.payLoan)
router.get('/accounting/retained-earnings', ...advancedRead(), validateRequest(FinanceCapitalValidation.retainedEarnings), FinanceCapitalController.retainedEarnings)

router.get('/billing-profile', ...read, FinanceController.getBillingProfile)
router.put('/billing-profile', ...write, validateRequest(FinanceValidation.updateBillingProfile), FinanceController.updateBillingProfile)
router.delete('/billing-profile', ...remove, validateRequest(FinanceValidation.removeBillingProfile), FinanceController.removeBillingProfile)

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
