import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { UserController } from './user.controller'
import { adminNetworkRateLimiter, adminOperationRateLimiter, exportRateLimiter } from '../../middlewares/rateLimiter'
import validateRequest from '../../middlewares/validateRequest'
import { UserValidation } from './user.validation'

const router = express.Router()

// Public endpoints
router.get('/public/:organizationId', UserController.getPublicAgents)
router.get('/public-agent/:id', UserController.getPublicAgentDetail)

// Authenticated endpoints
router.get('/me/access', authMiddlewares.auth(), UserController.getMyAccess)
router.get('/me/export', authMiddlewares.auth(), exportRateLimiter, UserController.exportMyData)
router.get('/me/profile', authMiddlewares.auth(), UserController.getMyProfile)
router.patch('/me/profile', authMiddlewares.auth(), validateRequest(UserValidation.selfProfile), UserController.updateMyProfile)

router.post(
  '/',
  authMiddlewares.requirePermission('users.write'),
  validateRequest(UserValidation.create),
  UserController.createUser
)

router.post(
  '/invite-agent',
  authMiddlewares.requirePermission('users.write'),
  validateRequest(UserValidation.create),
  UserController.inviteAgent
)

router.get(
  '/team-summary',
  authMiddlewares.requirePermission('users.read'),
  UserController.getTeamRoleSummary
)

router.get(
  '/leaderboard',
  authMiddlewares.requirePermission('users.read'),
  UserController.getAgentLeaderboard
)

router.get('/export.csv', authMiddlewares.requirePermission('users.read'), exportRateLimiter, UserController.exportTeamMembersCsv)

router.get(
  '/',
  authMiddlewares.requirePermission('users.read'),
  UserController.getAllUsers
)

router.patch(
  '/:id/public-broker',
  authMiddlewares.requirePermission('users.write'),
  validateRequest(UserValidation.publicBroker),
  UserController.updatePublicBrokerProfile
)

router.patch('/:id/access', authMiddlewares.auth('agency_owner'), validateRequest(UserValidation.memberAccess), UserController.updateMemberAccess)
router.patch(
  '/:id/seat-access',
  authMiddlewares.auth('agency_owner', 'agency_admin'),
  authMiddlewares.requirePermission('users.write'),
  validateRequest(UserValidation.memberSeatAccess),
  UserController.updateMemberSeatAccess,
)

// Platform routes must be explicit and declared before tenant `/:id` routes.
router.get('/super-admin/summary', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, UserController.getSuperAdminUserSummary)
router.get('/super-admin/export.csv', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, exportRateLimiter, UserController.exportUsersSuperAdminCsv)
router.get('/super-admin/all', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, UserController.getAllUsersSuperAdmin)
router.patch('/super-admin/:id/role', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter,
  validateRequest(UserValidation.platformRole), UserController.updateUserRoleSuperAdmin)
router.patch('/super-admin/:id/verify', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter,
  validateRequest(UserValidation.manualVerification), UserController.verifyUserSuperAdmin)

router.get(
  '/:id',
  authMiddlewares.requirePermission('users.read'),
  UserController.getUserById
)

router.patch(
  '/:id',
  authMiddlewares.requirePermission('users.write'),
  validateRequest(UserValidation.update),
  UserController.updateUserById
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('users.write'),
  UserController.deleteUserById
)

export const UserRoute = router
