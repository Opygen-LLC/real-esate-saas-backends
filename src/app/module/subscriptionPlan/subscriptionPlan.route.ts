import express from 'express'
import { SubscriptionPlanController } from './subscriptionPlan.controller'

const router = express.Router()

router.get('/', SubscriptionPlanController.getAllPlans)
router.get('/plans', SubscriptionPlanController.getAllPlans)

export const SubscriptionPlanRoute = router
