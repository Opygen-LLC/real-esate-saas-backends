import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { UserController } from './user.controller'
import validateRequest from '../../middlewares/validateRequest'
import { UserValidation } from './user.validation'

const router = express.Router()

// Public endpoints
router.get('/public/:organizationId', UserController.getPublicAgents)
router.get('/public-agent/:id', UserController.getPublicAgentDetail)

// Authenticated endpoints
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
  '/leaderboard',
  authMiddlewares.requirePermission('users.read'),
  UserController.getAgentLeaderboard
)

router.get(
  '/',
  authMiddlewares.requirePermission('users.read'),
  UserController.getAllUsers
)

// Platform routes must be explicit and declared before tenant `/:id` routes.
router.get('/super-admin/all', authMiddlewares.authSuperAdmin, UserController.getAllUsersSuperAdmin)
router.patch('/super-admin/:id/role', authMiddlewares.authSuperAdmin,
  validateRequest(UserValidation.platformRole), UserController.updateUserRoleSuperAdmin)

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
