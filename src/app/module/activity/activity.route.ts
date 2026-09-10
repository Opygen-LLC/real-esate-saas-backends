import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { ActivityController } from './activity.controller'
import validateRequest from '../../middlewares/validateRequest'
import { ActivityValidation } from './activity.validation'

const router = express.Router()

router.post(
  '/',
  authMiddlewares.requirePermission('leads.write'),
  validateRequest(ActivityValidation.createActivityZodSchema),
  ActivityController.createActivity
)

router.get(
  '/lead/:leadId',
  authMiddlewares.requirePermission('leads.read'),
  validateRequest(ActivityValidation.getActivitiesByLeadZodSchema),
  ActivityController.getActivitiesByLead
)

export const ActivityRoute = router
