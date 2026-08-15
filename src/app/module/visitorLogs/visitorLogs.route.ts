import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { VisitorLogsController } from './visitorLogs.controller'

const router = express.Router()

router.post('/log', VisitorLogsController.logVisitor)

router.get(
  '/analytics',
  authMiddlewares.requirePermission('analytics.advanced'),
  VisitorLogsController.getVisitorAnalytics
)

export const VisitorLogsRoute = router
