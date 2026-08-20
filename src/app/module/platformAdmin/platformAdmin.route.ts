import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { PlatformAdminController } from './platformAdmin.controller'
import { subscriptionPaymentDecisionSchema, subscriptionPaymentInputSchema } from '../subscriptionPayment/subscriptionPayment.validation'

const router = express.Router()
const subscriptionBody = z.object({ body: z.object({
  plan: z.enum(['trial', 'starter', 'professional', 'agency', 'enterprise']),
  planVersion: z.number().int().positive().optional(), periodDays: z.number().int().min(1).max(3660).optional(),
  reason: z.string().trim().min(10).max(500),
}) })
const trialBody = z.object({ body: z.object({
  action: z.enum(['extend', 'set_end', 'end', 'restart']), days: z.number().int().min(1).max(3650).optional(),
  trialEndsAt: z.string().datetime().optional(), reason: z.string().trim().min(10).max(500),
}) })
const reasonBody = z.object({ body: z.object({ reason: z.string().trim().min(10).max(500) }) })
const benefitHistoryQuery = z.object({ query: z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(200).optional(),
  organizationId: z.string().trim().max(120).optional(),
  planId: z.enum(['starter', 'professional', 'agency', 'enterprise']).optional(),
  paymentSource: z.enum(['manual_payment', 'bkash']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}) })
router.get('/search', authMiddlewares.authSuperAdmin, PlatformAdminController.platformSearch)
router.get('/notifications', authMiddlewares.authSuperAdmin, PlatformAdminController.platformNotifications)
router.get('/subscriptions/summary', authMiddlewares.authSuperAdmin, PlatformAdminController.subscriptionSummary)
router.patch('/tenants/:organizationId/subscription', authMiddlewares.authSuperAdmin, validateRequest(subscriptionBody), PlatformAdminController.changeTenantSubscription)
router.patch('/tenants/:organizationId/trial', authMiddlewares.authSuperAdmin, validateRequest(trialBody), PlatformAdminController.manageTenantTrial)
router.get('/tenants/health', authMiddlewares.authSuperAdmin, PlatformAdminController.tenantHealth)
router.post('/tenants/:organizationId/suspend', authMiddlewares.authSuperAdmin, validateRequest(reasonBody), PlatformAdminController.suspendTenant)
router.post('/tenants/:organizationId/reactivate', authMiddlewares.authSuperAdmin, validateRequest(reasonBody), PlatformAdminController.reactivateTenant)
router.get('/payments', authMiddlewares.authSuperAdmin, PlatformAdminController.paymentLedger)
router.get('/benefit-periods', authMiddlewares.authSuperAdmin, validateRequest(benefitHistoryQuery), PlatformAdminController.benefitPeriodHistory)
router.post('/payments', authMiddlewares.authSuperAdmin, validateRequest(z.object({ body: subscriptionPaymentInputSchema })), PlatformAdminController.recordManualPayment)
router.patch('/payments/:paymentId/decision', authMiddlewares.authSuperAdmin, validateRequest(z.object({ params: z.object({ paymentId: z.string().trim().min(8).max(80) }), body: subscriptionPaymentDecisionSchema })), PlatformAdminController.decideManualPayment)
router.get('/revenue', authMiddlewares.authSuperAdmin, PlatformAdminController.revenue)
router.get('/audit', authMiddlewares.authSuperAdmin, PlatformAdminController.audit)

export const PlatformAdminRoute = router
