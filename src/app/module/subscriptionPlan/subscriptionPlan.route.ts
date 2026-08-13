import express from 'express'
import { SubscriptionPlanController } from './subscriptionPlan.controller'

import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { SubscriptionPlanValidation } from './subscriptionPlan.validation'

const router = express.Router()

router.get('/', SubscriptionPlanController.getAllPlans)
router.get('/plans', SubscriptionPlanController.getAllPlans)

router.post(
  '/',
  authMiddlewares.authSuperAdmin,
  validateRequest(SubscriptionPlanValidation.create),
  SubscriptionPlanController.createPlan
)

router.patch(
  '/:id',
  authMiddlewares.authSuperAdmin,
  validateRequest(SubscriptionPlanValidation.update),
  SubscriptionPlanController.updatePlan
)

router.delete(
  '/:id',
  authMiddlewares.authSuperAdmin,
  SubscriptionPlanController.deletePlan
)

export const SubscriptionPlanRoute = router
