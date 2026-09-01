import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { FinanceController } from './finance.controller'
import { FinanceValidation } from './finance.validation'
import { FinanceAccountingSettingsController } from './financeAccountingSettings.controller'
import { FinanceAccountingSettingsValidation } from './financeAccountingSettings.validation'

const router = express.Router()
const read = [authMiddlewares.auth(), authMiddlewares.requirePermission('finance.read')] as const
const write = [authMiddlewares.auth(), authMiddlewares.requirePermission('finance.write')] as const
const remove = [authMiddlewares.auth(), authMiddlewares.requirePermission('finance.delete')] as const
const advancedRead = [authMiddlewares.auth(), authMiddlewares.requirePermission('finance.read'), authMiddlewares.requireEntitlement('ADVANCED_ACCOUNTING')] as const
const advancedWrite = [authMiddlewares.auth(), authMiddlewares.requirePermission('finance.write'), authMiddlewares.requireEntitlement('ADVANCED_ACCOUNTING')] as const

router.get('/accounting/settings', ...advancedRead, FinanceAccountingSettingsController.get)
router.patch('/accounting/settings', ...advancedWrite, validateRequest(FinanceAccountingSettingsValidation.update), FinanceAccountingSettingsController.update)

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
