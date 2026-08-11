import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { ActivityController } from './activity.controller'

const router = express.Router()

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  ActivityController.createActivity
)

router.get(
  '/lead/:leadId',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'viewer', 'super-admin', 'admin', 'client'),
  ActivityController.getActivitiesByLead
)

export const ActivityRoute = router
