import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { DashboardController } from './dashboard.controller'
import { adminNetworkRateLimiter, adminOperationRateLimiter, exportRateLimiter, reportRateLimiter, searchRateLimiter } from '../../middlewares/rateLimiter'

const router = express.Router()

router.get(
  '/search',
  authMiddlewares.requirePermission('dashboard.read'),
  searchRateLimiter,
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
  reportRateLimiter,
  DashboardController.getAnalytics
)

router.get('/analytics/brokers', authMiddlewares.requirePermission('analytics.read'), reportRateLimiter, DashboardController.getBrokerPerformance)
router.get('/analytics/brokers/export.csv', authMiddlewares.requirePermission('analytics.read'), exportRateLimiter, DashboardController.exportBrokerPerformanceCsv)

router.get(
  '/super-admin-overview',
  adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter,
  DashboardController.getSuperAdminOverviewStats
)

export const DashboardRoute = router
