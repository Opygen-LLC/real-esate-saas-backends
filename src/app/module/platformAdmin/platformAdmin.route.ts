import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { PlatformAdminController } from './platformAdmin.controller'
import { subscriptionPaymentDecisionSchema, subscriptionPaymentInputSchema } from '../subscriptionPayment/subscriptionPayment.validation'
import { paidPlanIdSchema } from '../subscriptionPlan/subscriptionPlan.validation'

const router = express.Router()
const subscriptionBody = z.object({ body: z.object({
  plan: z.union([z.literal('trial'), paidPlanIdSchema]),
  planVersion: z.number().int().positive().optional(), periodDays: z.number().int().min(1).max(3660).optional(),
  reason: z.string().trim().min(10).max(500),
}) })
const trialBody = z.object({ body: z.object({
  action: z.enum(['extend', 'set_end', 'end', 'restart']), days: z.number().int().min(1).max(3650).optional(),
  trialEndsAt: z.string().datetime().optional(), reason: z.string().trim().min(10).max(500),
}) })
const reasonBody = z.object({ body: z.object({ reason: z.string().trim().min(10).max(500) }) })
const organizationParams = z.object({ organizationId: z.string().trim().min(3).max(120) })
const tenantLeadEntitlementParams = z.object({ params: organizationParams })
const renewalStreakBody = z.object({
  params: organizationParams,
  body: z.object({
    renewalStreak: z.number().int().min(1).max(10000),
    reason: z.string().trim().min(10).max(500),
  }),
})
const subscriptionRequestQuery = z.object({ query: z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(200).optional(),
  status: z.enum(['open', 'all', 'pending_payment', 'payment_submitted', 'scheduled', 'approved', 'applied', 'rejected', 'cancelled']).optional(),
  planId: paidPlanIdSchema.optional(),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
}) })
const benefitHistoryQuery = z.object({ query: z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(200).optional(),
  organizationId: z.string().trim().max(120).optional(),
  planId: paidPlanIdSchema.optional(),
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
router.get('/tenants/:organizationId', authMiddlewares.authSuperAdmin, validateRequest(z.object({ params: organizationParams })), PlatformAdminController.tenantDetails)
router.post('/tenants/:organizationId/suspend', authMiddlewares.authSuperAdmin, validateRequest(reasonBody), PlatformAdminController.suspendTenant)
router.post('/tenants/:organizationId/reactivate', authMiddlewares.authSuperAdmin, validateRequest(reasonBody), PlatformAdminController.reactivateTenant)
router.get('/subscription-requests', authMiddlewares.authSuperAdmin, validateRequest(subscriptionRequestQuery), PlatformAdminController.subscriptionRequests)
router.get('/payments', authMiddlewares.authSuperAdmin, PlatformAdminController.paymentLedger)
router.get('/benefit-periods', authMiddlewares.authSuperAdmin, validateRequest(benefitHistoryQuery), PlatformAdminController.benefitPeriodHistory)
router.get('/tenants/:organizationId/lead-entitlement', authMiddlewares.authSuperAdmin, validateRequest(tenantLeadEntitlementParams), PlatformAdminController.tenantLeadEntitlement)
router.patch('/tenants/:organizationId/renewal-streak', authMiddlewares.authSuperAdmin, validateRequest(renewalStreakBody), PlatformAdminController.adjustTenantRenewalStreak)
router.post('/payments', authMiddlewares.authSuperAdmin, validateRequest(z.object({ body: subscriptionPaymentInputSchema })), PlatformAdminController.recordManualPayment)
router.patch('/payments/:paymentId/decision', authMiddlewares.authSuperAdmin, validateRequest(z.object({ params: z.object({ paymentId: z.string().trim().min(8).max(80) }), body: subscriptionPaymentDecisionSchema })), PlatformAdminController.decideManualPayment)
router.get('/revenue', authMiddlewares.authSuperAdmin, PlatformAdminController.revenue)
router.get('/audit', authMiddlewares.authSuperAdmin, PlatformAdminController.audit)

export const PlatformAdminRoute = router
