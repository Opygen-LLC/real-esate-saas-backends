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

export const BillingRoute = router
