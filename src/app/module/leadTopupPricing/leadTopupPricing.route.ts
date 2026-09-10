import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { adminNetworkRateLimiter, adminOperationRateLimiter } from '../../middlewares/rateLimiter'
import { LeadTopupPricingController } from './leadTopupPricing.controller'
import { LeadTopupPricingValidation } from './leadTopupPricing.validation'

const router = express.Router()

router.get('/active', authMiddlewares.requirePermission('billing.manage'), LeadTopupPricingController.listPublic)
router.get('/admin', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(z.object({ query: z.object({ page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional(), status: z.enum(['all', 'active', 'archived']).optional(), pricingMode: z.enum(['rate', 'package']).optional() }) })), LeadTopupPricingController.listAdmin)
router.post('/admin', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(LeadTopupPricingValidation.create), LeadTopupPricingController.create)
router.patch('/admin/:id', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(LeadTopupPricingValidation.update), LeadTopupPricingController.update)
router.delete('/admin/:id', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(LeadTopupPricingValidation.archive), LeadTopupPricingController.archive)

export const LeadTopupPricingRoute = router
