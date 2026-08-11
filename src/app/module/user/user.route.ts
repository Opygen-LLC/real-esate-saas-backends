import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { UserController } from './user.controller'

const router = express.Router()

// Public endpoints
router.get('/public/:organizationId', UserController.getPublicAgents)
router.get('/public-agent/:id', UserController.getPublicAgentDetail)

// Authenticated endpoints
router.post(
  '/',
  authMiddlewares.auth('super-admin', 'agency_owner', 'agency_admin', 'admin', 'client'),
  UserController.createUser
)

router.post(
  '/invite-agent',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  UserController.inviteAgent
)

router.get(
  '/leaderboard',
  authMiddlewares.auth('super-admin', 'agency_owner', 'agency_admin', 'agent', 'viewer', 'admin', 'client', 'staff'),
  UserController.getAgentLeaderboard
)

router.get(
  '/',
  authMiddlewares.auth('super-admin', 'agency_owner', 'agency_admin', 'agent', 'viewer', 'admin', 'client', 'staff'),
  UserController.getAllUsers
)

router.get(
  '/:id',
  authMiddlewares.auth('super-admin', 'agency_owner', 'agency_admin', 'agent', 'viewer', 'admin', 'client', 'staff'),
  UserController.getUserById
)

router.patch(
  '/:id',
  authMiddlewares.auth('super-admin', 'agency_owner', 'agency_admin', 'admin', 'client'),
  UserController.updateUserById
)

router.delete(
  '/:id',
  authMiddlewares.auth('super-admin', 'agency_owner', 'admin', 'client'),
  UserController.deleteUserById
)

export const UserRoute = router
