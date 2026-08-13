import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { BillingController } from './billing.controller'
import { BkashPaymentRoute } from '../bkashPayment/bkashPayment.route'

const router = express.Router()

router.use('/bkash', BkashPaymentRoute)

router.get(
  '/usage',
  authMiddlewares.auth(),
  BillingController.getSubscriptionUsage
)

router.get(
  '/history',
  authMiddlewares.requirePermission('billing.manage'),
  BillingController.getBillingHistory
)

router.post(
  '/change-plan',
  authMiddlewares.requirePermission('billing.manage'),
  BillingController.changeSubscriptionPlan
)

router.post(
  '/cancel',
  authMiddlewares.requirePermission('billing.manage'),
  BillingController.cancelSubscription
)

router.get(
  '/history/:id/receipt',
  authMiddlewares.requirePermission('billing.manage'),
  BillingController.getInvoiceReceipt
)

export const BillingRoute = router
