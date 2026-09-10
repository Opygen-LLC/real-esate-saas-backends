import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { adminNetworkRateLimiter, adminOperationRateLimiter } from '../../middlewares/rateLimiter'
import { paidPlanIdSchema } from '../subscriptionPlan/subscriptionPlan.validation'
import { LeadAddonDefinitionController } from './leadAddonDefinition.controller'
import { LeadAddonDefinitionValidation } from './leadAddonDefinition.validation'

const router = express.Router()
router.get('/catalog', authMiddlewares.requirePermission('billing.manage'), LeadAddonDefinitionController.listEligible)
router.get('/admin', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(z.object({ query: z.object({ page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional(), status: z.enum(['all', 'active', 'archived']).optional(), planId: paidPlanIdSchema.optional() }) })), LeadAddonDefinitionController.listAdmin)
router.post('/admin', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(LeadAddonDefinitionValidation.create), LeadAddonDefinitionController.create)
router.patch('/admin/:id', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(LeadAddonDefinitionValidation.update), LeadAddonDefinitionController.update)
router.delete('/admin/:id', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(LeadAddonDefinitionValidation.archive), LeadAddonDefinitionController.archive)
export const LeadAddonDefinitionRoute = router
