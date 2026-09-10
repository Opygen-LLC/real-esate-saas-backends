import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { VisitorLogsController } from './visitorLogs.controller'
import validateRequest from '../../middlewares/validateRequest'
import { VisitorLogsValidation } from './visitorLogs.validation'

const router = express.Router()

router.post('/log', validateRequest(VisitorLogsValidation.log), VisitorLogsController.logVisitor)

router.get(
  '/analytics',
  authMiddlewares.requirePermission('analytics.advanced'),
  VisitorLogsController.getVisitorAnalytics
)

export const VisitorLogsRoute = router
