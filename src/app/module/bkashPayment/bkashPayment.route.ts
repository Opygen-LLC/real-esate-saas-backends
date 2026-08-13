import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { BkashPaymentController } from './bkashPayment.controller'
import { BkashPaymentValidation } from './bkashPayment.validation'

const router = express.Router()

router.get('/callback', BkashPaymentController.callback)

router.post(
  '/create',
  authMiddlewares.requirePermission('billing.manage'),
  validateRequest(BkashPaymentValidation.createPayment),
  BkashPaymentController.createPayment
)

router.get(
  '/status/:paymentId',
  authMiddlewares.requirePermission('billing.manage'),
  validateRequest(BkashPaymentValidation.paymentStatus),
  BkashPaymentController.getPaymentStatus
)

router.get('/admin/search', authMiddlewares.authSuperAdmin, BkashPaymentController.searchPayments)
router.post('/admin/:paymentId/reconcile', authMiddlewares.authSuperAdmin,
  validateRequest(BkashPaymentValidation.manualReconcile), BkashPaymentController.manualReconcile)

export const BkashPaymentRoute = router
