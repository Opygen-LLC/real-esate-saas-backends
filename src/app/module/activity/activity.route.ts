import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { ActivityController } from './activity.controller'

const router = express.Router()

router.post(
  '/',
  authMiddlewares.requirePermission('leads.write'),
  ActivityController.createActivity
)

router.get(
  '/lead/:leadId',
  authMiddlewares.requirePermission('leads.read'),
  ActivityController.getActivitiesByLead
)

export const ActivityRoute = router
