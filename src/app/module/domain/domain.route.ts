import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { DomainController } from './domain.controller'
import validateRequest from '../../middlewares/validateRequest'
import { z } from 'zod'

const router = express.Router()

router.post(
  '/add',
  authMiddlewares.requirePermission('domains.manage'),
  validateRequest(z.object({ body: z.object({ domain: z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/) }) })),
  DomainController.addCustomDomain
)

router.post(
  '/verify',
  authMiddlewares.requirePermission('domains.manage'),
  DomainController.verifyCustomDomain
)

export const DomainRoute = router
