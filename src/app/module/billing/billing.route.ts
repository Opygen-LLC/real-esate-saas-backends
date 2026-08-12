import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { BillingController } from './billing.controller'

const router = express.Router()

router.get(
  '/usage',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'viewer', 'super-admin', 'admin', 'client'),
  BillingController.getSubscriptionUsage
)

router.get(
  '/history',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'super-admin', 'admin', 'client'),
  BillingController.getBillingHistory
)

router.post(
  '/change-plan',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'super-admin', 'admin', 'client'),
  BillingController.changeSubscriptionPlan
)

router.post(
  '/cancel',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'super-admin', 'admin'),
  BillingController.cancelSubscription
)

router.get(
  '/history/:id/receipt',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'super-admin', 'admin', 'client'),
  BillingController.getInvoiceReceipt
)

export const BillingRoute = router
