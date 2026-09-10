import express from 'express'
import { SubscriptionPlanController } from './subscriptionPlan.controller'

import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { adminNetworkRateLimiter, adminOperationRateLimiter } from '../../middlewares/rateLimiter'
import { SubscriptionPlanValidation } from './subscriptionPlan.validation'

const router = express.Router()

router.get('/', SubscriptionPlanController.getAllPlans)
router.get('/plans', SubscriptionPlanController.getAllPlans)
router.get('/admin/versions', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, SubscriptionPlanController.getAllPlanVersions)

router.post(
  '/',
  adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter,
  validateRequest(SubscriptionPlanValidation.create),
  SubscriptionPlanController.createPlan
)

router.patch(
  '/:id',
  adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter,
  validateRequest(SubscriptionPlanValidation.update),
  SubscriptionPlanController.updatePlan
)

router.delete(
  '/:id',
  adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter,
  validateRequest(SubscriptionPlanValidation.archive),
  SubscriptionPlanController.deletePlan
)

export const SubscriptionPlanRoute = router
