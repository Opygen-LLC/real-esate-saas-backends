import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { DomainController } from './domain.controller'

const router = express.Router()

router.post(
  '/add',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'super-admin', 'admin', 'client'),
  DomainController.addCustomDomain
)

router.post(
  '/verify',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'super-admin', 'admin', 'client'),
  DomainController.verifyCustomDomain
)

export const DomainRoute = router
