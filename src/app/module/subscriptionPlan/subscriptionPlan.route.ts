import express from 'express'
import { SubscriptionPlanController } from './subscriptionPlan.controller'

import { authMiddlewares } from '../../middlewares/auth'

const router = express.Router()

router.get('/', SubscriptionPlanController.getAllPlans)
router.get('/plans', SubscriptionPlanController.getAllPlans)

router.post(
  '/',
  authMiddlewares.authSuperAdmin,
  SubscriptionPlanController.createPlan
)

router.patch(
  '/:id',
  authMiddlewares.authSuperAdmin,
  SubscriptionPlanController.updatePlan
)

router.delete(
  '/:id',
  authMiddlewares.authSuperAdmin,
  SubscriptionPlanController.deletePlan
)

export const SubscriptionPlanRoute = router
