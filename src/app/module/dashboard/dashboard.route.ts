import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { DashboardController } from './dashboard.controller'

const router = express.Router()

router.get(
  '/overview',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'viewer', 'super-admin', 'admin', 'client'),
  DashboardController.getOverviewStats
)

router.get(
  '/analytics',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'viewer', 'super-admin', 'admin', 'client'),
  DashboardController.getAnalytics
)

export const DashboardRoute = router
