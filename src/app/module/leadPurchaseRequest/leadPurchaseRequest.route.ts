import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { adminNetworkRateLimiter, adminOperationRateLimiter } from '../../middlewares/rateLimiter'
import { LeadPurchaseRequestController } from './leadPurchaseRequest.controller'
import { LeadPurchaseRequestValidation } from './leadPurchaseRequest.validation'

const router = express.Router()

router.get('/', authMiddlewares.requirePermission('billing.manage'), LeadPurchaseRequestController.tenantList)
router.post('/', authMiddlewares.requirePermission('billing.manage'), validateRequest(LeadPurchaseRequestValidation.create), LeadPurchaseRequestController.create)
router.post('/:id/cancel', authMiddlewares.requirePermission('billing.manage'), validateRequest(LeadPurchaseRequestValidation.cancel), LeadPurchaseRequestController.cancel)
router.get('/admin/all', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(LeadPurchaseRequestValidation.adminList), LeadPurchaseRequestController.adminList)
router.patch('/admin/:id/decision', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(LeadPurchaseRequestValidation.decision), LeadPurchaseRequestController.decision)

export const LeadPurchaseRequestRoute = router
