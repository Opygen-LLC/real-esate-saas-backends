import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { VisitorLogsController } from './visitorLogs.controller'

const router = express.Router()

router.post('/log', VisitorLogsController.logVisitor)

router.get(
  '/analytics',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'super-admin', 'admin', 'client', 'staff'),
  VisitorLogsController.getVisitorAnalytics
)

export const VisitorLogsRoute = router
