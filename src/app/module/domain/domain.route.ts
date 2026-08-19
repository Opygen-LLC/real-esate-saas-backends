import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { DomainController } from './domain.controller'

const router = express.Router()
router.get('/subdomain/availability/:value', authMiddlewares.requirePermission('website.write'), DomainController.getSubdomainAvailability)
router.patch('/subdomain', authMiddlewares.requirePermission('website.write'), validateRequest(z.object({ body: z.object({ subdomain: z.string().trim().min(2).max(48) }) })), DomainController.changeSubdomain)
router.get('/resolve-subdomain/:subdomain', DomainController.resolveSubdomain)
router.get('/status', authMiddlewares.requirePermission('domains.manage'), DomainController.getCustomDomain)
router.get('/health', authMiddlewares.requirePermission('domains.manage'), DomainController.getDomainHealth)
router.post('/add', authMiddlewares.requirePermission('domains.manage'), validateRequest(z.object({ body: z.object({ domain: z.string().trim().min(4).max(253) }) })), DomainController.addCustomDomain)
router.post('/verify', authMiddlewares.requirePermission('domains.manage'), DomainController.verifyCustomDomain)
router.get('/resolve/:host', DomainController.resolveHost)
export const DomainRoute = router
