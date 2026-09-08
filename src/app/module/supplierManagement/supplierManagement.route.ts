import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { SupplierManagementController } from './supplierManagement.controller'
import { SupplierManagementValidation } from './supplierManagement.validation'

const router = express.Router()
router.use(authMiddlewares.auth(), authMiddlewares.requireEntitlement('SUPPLIER_MANAGEMENT'))

router.get('/available-vendors', authMiddlewares.requirePermission('suppliers.write'), validateRequest(SupplierManagementValidation.availableVendors), SupplierManagementController.availableVendors)
router.get('/material-options', authMiddlewares.requirePermission('suppliers.read'), SupplierManagementController.materialOptions)
router.get('/purchases/cost-summary', authMiddlewares.requirePermission('suppliers.read'), validateRequest(SupplierManagementValidation.costSummary), SupplierManagementController.costSummary)
router.get('/purchases', authMiddlewares.requirePermission('suppliers.read'), validateRequest(SupplierManagementValidation.listPurchases), SupplierManagementController.listPurchases)
router.post('/purchases', authMiddlewares.requirePermission('suppliers.write'), validateRequest(SupplierManagementValidation.createPurchase), SupplierManagementController.createPurchase)
router.patch('/purchases/:purchaseId', authMiddlewares.requirePermission('suppliers.write'), validateRequest(SupplierManagementValidation.updatePurchase), SupplierManagementController.updatePurchase)
router.post('/purchases/:purchaseId/receive', authMiddlewares.requirePermission('suppliers.write'), validateRequest(SupplierManagementValidation.receivePurchase), SupplierManagementController.receivePurchase)
router.post('/purchases/:purchaseId/payments', authMiddlewares.requirePermission('suppliers.payments'), validateRequest(SupplierManagementValidation.recordPayment), SupplierManagementController.recordPayment)
router.post('/purchases/:purchaseId/payments/:paymentId/void', authMiddlewares.requirePermission('suppliers.payments'), validateRequest(SupplierManagementValidation.voidPayment), SupplierManagementController.voidPayment)
router.post('/purchases/:purchaseId/cancel', authMiddlewares.requirePermission('suppliers.write'), validateRequest(SupplierManagementValidation.cancelPurchase), SupplierManagementController.cancelPurchase)
router.post('/purchases/:purchaseId/invoice-attachment/presign', authMiddlewares.requirePermission('suppliers.write'), validateRequest(SupplierManagementValidation.presignInvoice), SupplierManagementController.presignInvoice)
router.post('/purchases/:purchaseId/invoice-attachment/:assetId/complete', authMiddlewares.requirePermission('suppliers.write'), validateRequest(SupplierManagementValidation.completeInvoice), SupplierManagementController.completeInvoice)
router.get('/purchases/:purchaseId/invoice-attachment/download', authMiddlewares.requirePermission('suppliers.read'), validateRequest(SupplierManagementValidation.purchaseId), SupplierManagementController.downloadInvoice)
router.delete('/purchases/:purchaseId/invoice-attachment', authMiddlewares.requirePermission('suppliers.write'), validateRequest(SupplierManagementValidation.purchaseId), SupplierManagementController.removeInvoice)
router.get('/materials/:materialId/latest-prices', authMiddlewares.requirePermission('suppliers.read'), validateRequest(SupplierManagementValidation.latestPrices), SupplierManagementController.latestPrices)

router.get('/', authMiddlewares.requirePermission('suppliers.read'), validateRequest(SupplierManagementValidation.listSuppliers), SupplierManagementController.listSuppliers)
router.post('/', authMiddlewares.requirePermission('suppliers.write'), validateRequest(SupplierManagementValidation.createSupplier), SupplierManagementController.createSupplier)
router.get('/:supplierId', authMiddlewares.requirePermission('suppliers.read'), validateRequest(SupplierManagementValidation.supplierId), SupplierManagementController.getSupplier)
router.patch('/:supplierId', authMiddlewares.requirePermission('suppliers.write'), validateRequest(SupplierManagementValidation.updateSupplier), SupplierManagementController.updateSupplier)

export const SupplierManagementRoute = router
