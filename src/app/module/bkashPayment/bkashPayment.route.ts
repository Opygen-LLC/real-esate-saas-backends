import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { BkashPaymentController } from './bkashPayment.controller'
import { BkashPaymentValidation } from './bkashPayment.validation'
import { adminNetworkRateLimiter, adminOperationRateLimiter, searchRateLimiter } from '../../middlewares/rateLimiter'

const router = express.Router()

router.get('/callback', BkashPaymentController.callback)

router.post(
  '/create',
  authMiddlewares.requirePermission('billing.manage'),
  adminOperationRateLimiter,
  validateRequest(BkashPaymentValidation.createPayment),
  BkashPaymentController.createPayment
)

router.get(
  '/status/:paymentId',
  authMiddlewares.requirePermission('billing.manage'),
  validateRequest(BkashPaymentValidation.paymentStatus),
  BkashPaymentController.getPaymentStatus
)

router.get('/admin/search', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, searchRateLimiter, BkashPaymentController.searchPayments)
router.post('/admin/:paymentId/reconcile', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter,
  validateRequest(BkashPaymentValidation.manualReconcile), BkashPaymentController.manualReconcile)

export const BkashPaymentRoute = router
