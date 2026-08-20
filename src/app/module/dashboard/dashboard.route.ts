import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { DashboardController } from './dashboard.controller'

const router = express.Router()

router.get(
  '/search',
  authMiddlewares.requirePermission('dashboard.read'),
  DashboardController.globalSearch
)

router.get(
  '/overview',
  authMiddlewares.requirePermission('dashboard.read'),
  DashboardController.getOverviewStats
)

router.get(
  '/analytics',
  authMiddlewares.requirePermission('analytics.read'),
  DashboardController.getAnalytics
)

router.get('/analytics/brokers', authMiddlewares.requirePermission('analytics.read'), DashboardController.getBrokerPerformance)
router.get('/analytics/brokers/export.csv', authMiddlewares.requirePermission('analytics.read'), DashboardController.exportBrokerPerformanceCsv)

router.get(
  '/super-admin-overview',
  authMiddlewares.authSuperAdmin,
  DashboardController.getSuperAdminOverviewStats
)

export const DashboardRoute = router
