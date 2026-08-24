import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { LeadAddonSubscriptionController } from './leadAddonSubscription.controller'
import { LeadAddonSubscriptionValidation } from './leadAddonSubscription.validation'

const router = express.Router()
router.post('/quote', authMiddlewares.requirePermission('billing.manage'), validateRequest(LeadAddonSubscriptionValidation.quote), LeadAddonSubscriptionController.quote)
router.post('/subscribe', authMiddlewares.requirePermission('billing.manage'), validateRequest(LeadAddonSubscriptionValidation.subscribe), LeadAddonSubscriptionController.subscribe)
router.get('/subscriptions', authMiddlewares.requirePermission('billing.manage'), LeadAddonSubscriptionController.listTenant)
router.post('/subscriptions/:id/cancel', authMiddlewares.requirePermission('billing.manage'), validateRequest(LeadAddonSubscriptionValidation.id), LeadAddonSubscriptionController.cancel)
router.get('/admin/subscriptions', authMiddlewares.authSuperAdmin, validateRequest(z.object({ query: z.object({ page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional(), status: z.enum(['all', 'pending_payment', 'active', 'cancel_at_period_end', 'cancelled', 'expired', 'payment_failed', 'rejected']).optional(), organizationId: z.string().trim().min(1).optional() }) })), LeadAddonSubscriptionController.listAdmin)
router.patch('/admin/subscriptions/:id/decision', authMiddlewares.authSuperAdmin, validateRequest(LeadAddonSubscriptionValidation.decision), LeadAddonSubscriptionController.decide)
export const LeadAddonSubscriptionRoute = router
