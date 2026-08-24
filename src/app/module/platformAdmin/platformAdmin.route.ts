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
const tenantProfileBody = z.object({
  params: z.object({ organizationId: z.string().trim().min(3).max(120) }),
  body: z.object({
    agencyName: z.string().trim().min(2).max(120).optional(),
    agencyType: z.enum(['residential', 'commercial', 'mixed', 'brokerage', 'developer', 'general']).optional(),
    businessEmail: z.string().trim().email().max(254).optional(),
    businessPhone: z.string().trim().min(5).max(40).optional(),
    licenseNumber: z.string().trim().max(100).optional(),
    address: z.string().trim().max(250).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    country: z.string().trim().max(100).optional(),
    zipCode: z.string().trim().max(30).optional(),
    defaultLanguage: z.enum(['en', 'bn']).optional(),
    addressDetails: z.object({
      divisionId: z.string().trim().max(80).optional(), division: z.string().trim().max(100).optional(),
      districtId: z.string().trim().max(80).optional(), district: z.string().trim().max(100).optional(),
      upazilaId: z.string().trim().max(80).optional(), upazila: z.string().trim().max(100).optional(),
      areaId: z.string().trim().max(80).optional(), area: z.string().trim().max(120).optional(),
      road: z.string().trim().max(120).optional(), block: z.string().trim().max(80).optional(),
      sector: z.string().trim().max(80).optional(), mouza: z.string().trim().max(100).optional(),
      postalCode: z.string().trim().max(30).optional(), landmark: z.string().trim().max(160).optional(),
    }).partial().optional(),
    operationalSettings: z.object({
      defaultRole: z.enum(['agent', 'staff', 'agency_admin']).optional(),
      agentsCanViewAllLeads: z.boolean().optional(),
      leaderboardVisible: z.boolean().optional(),
      autoAssignLeads: z.boolean().optional(),
    }).partial().optional(),
    reason: z.string().trim().min(10).max(500),
  }).refine((body) => Object.keys(body).some((key) => key !== 'reason' && body[key as keyof typeof body] !== undefined), { message: 'At least one agency field must be provided' }),
})
const tenantOwnerBody = z.object({
  params: z.object({ organizationId: z.string().trim().min(3).max(120) }),
  body: z.object({
    name: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().email().max(254).optional(),
    phoneNumber: z.string().trim().min(10).max(30).optional(),
    reason: z.string().trim().min(10).max(500),
  }).refine((body) => body.name !== undefined || body.email !== undefined || body.phoneNumber !== undefined, { message: 'At least one owner field must be provided' }),
})
const deletionBody = z.object({
  params: z.object({ organizationId: z.string().trim().min(3).max(120) }),
  body: z.object({
    confirmation: z.string().trim().min(3).max(160),
    reason: z.string().trim().min(10).max(500),
  }),
})
const organizationParams = z.object({ organizationId: z.string().trim().min(3).max(120) })

const adminPlanOverrideBody = z.object({ params: organizationParams, body: z.object({
  planId: paidPlanIdSchema, planVersion: z.number().int().positive().optional(), billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  reason: z.string().trim().min(10).max(500),
}) })
const cancellationBody = z.object({ params: organizationParams, body: z.object({ cancelAtPeriodEnd: z.boolean(), reason: z.string().trim().min(10).max(500) }) })
const adminAddonBody = z.object({ params: organizationParams, body: z.object({ definitionId: z.string().trim().min(8).max(80), quoteCalculatedAt: z.string().datetime().optional(), reason: z.string().trim().min(10).max(500) }) })
const numericOverride = z.object({ mode: z.enum(['add', 'set']), value: z.number().int().nonnegative() }).strict()
const tenantOverrideBody = z.object({ params: organizationParams, body: z.object({
  resources: z.object({ leads: numericOverride.optional(), properties: numericOverride.optional(), teamMembers: numericOverride.optional(), storageMb: numericOverride.optional(), monthlyVisitors: numericOverride.optional() }).strict().optional(),
  features: z.object({ customDomain: z.boolean().optional(), advancedAnalytics: z.boolean().optional(), whatsappIntegration: z.boolean().optional(), smsAutomation: z.boolean().optional(), leadAutomations: z.boolean().optional(), premiumTemplates: z.boolean().optional() }).strict().optional(),
  expiresAt: z.string().datetime().nullable().optional(), reason: z.string().trim().min(10).max(500),
}).refine((body) => Object.values(body.resources || {}).some(Boolean) || Object.values(body.features || {}).some((value) => typeof value === 'boolean'), { message: 'At least one tenant-specific entitlement override is required' }) })

const subscriptionDateAdjustmentBody = z.object({
  params: z.object({ paymentNumber: z.string().trim().regex(/^PAY-[A-Z0-9-]+$/).max(120) }),
  body: z.object({
    paidAt: z.string().datetime(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    reason: z.string().trim().min(10).max(500),
  }).refine((body) => new Date(body.periodEnd).getTime() > new Date(body.periodStart).getTime(), { message: 'Period End / Access Until must be later than Period Start', path: ['periodEnd'] }),
})
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
  paymentSource: z.enum(['manual_payment', 'bkash', 'manual_admin']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}) })
router.get('/search', authMiddlewares.authSuperAdmin, PlatformAdminController.platformSearch)
router.get('/notifications', authMiddlewares.authSuperAdmin, PlatformAdminController.platformNotifications)
router.get('/subscriptions/summary', authMiddlewares.authSuperAdmin, PlatformAdminController.subscriptionSummary)
router.patch('/tenants/:organizationId/subscription', authMiddlewares.authSuperAdmin, validateRequest(subscriptionBody), PlatformAdminController.changeTenantSubscription)
router.patch('/tenants/:organizationId/trial', authMiddlewares.authSuperAdmin, validateRequest(trialBody), PlatformAdminController.manageTenantTrial)
router.patch('/subscription-payments/:paymentNumber/dates', authMiddlewares.authSuperAdmin, validateRequest(subscriptionDateAdjustmentBody), PlatformAdminController.editSubscriptionDates)
router.post('/tenants/:organizationId/subscription/admin-override', authMiddlewares.authSuperAdmin, validateRequest(adminPlanOverrideBody), PlatformAdminController.applyTenantAdminPlanOverride)
router.post('/tenants/:organizationId/subscription/schedule-downgrade', authMiddlewares.authSuperAdmin, validateRequest(adminPlanOverrideBody), PlatformAdminController.scheduleTenantAdminDowngrade)
router.post('/tenants/:organizationId/subscription/cancel-scheduled-change', authMiddlewares.authSuperAdmin, validateRequest(z.object({ params: organizationParams, body: reasonBody.shape.body })), PlatformAdminController.cancelTenantScheduledChange)
router.patch('/tenants/:organizationId/subscription/cancellation', authMiddlewares.authSuperAdmin, validateRequest(cancellationBody), PlatformAdminController.setTenantCancellation)
router.post('/tenants/:organizationId/subscription/recurring-addon', authMiddlewares.authSuperAdmin, validateRequest(adminAddonBody), PlatformAdminController.requestTenantRecurringAddon)
router.get('/tenants/:organizationId/entitlement-overrides', authMiddlewares.authSuperAdmin, validateRequest(z.object({ params: organizationParams })), PlatformAdminController.getTenantEntitlementOverrides)
router.post('/tenants/:organizationId/entitlement-overrides', authMiddlewares.authSuperAdmin, validateRequest(tenantOverrideBody), PlatformAdminController.setTenantEntitlementOverride)
router.post('/tenants/:organizationId/entitlement-overrides/revoke', authMiddlewares.authSuperAdmin, validateRequest(z.object({ params: organizationParams, body: reasonBody.shape.body })), PlatformAdminController.revokeTenantEntitlementOverride)
router.get('/tenants/health', authMiddlewares.authSuperAdmin, PlatformAdminController.tenantHealth)
router.get('/tenants/:organizationId', authMiddlewares.authSuperAdmin, validateRequest(z.object({ params: organizationParams })), PlatformAdminController.tenantDetails)
router.patch('/tenants/:organizationId/profile', authMiddlewares.authSuperAdmin, validateRequest(tenantProfileBody), PlatformAdminController.updateTenantProfile)
router.patch('/tenants/:organizationId/owner', authMiddlewares.authSuperAdmin, validateRequest(tenantOwnerBody), PlatformAdminController.updateTenantOwner)
router.post('/tenants/:organizationId/archive', authMiddlewares.authSuperAdmin, validateRequest(z.object({ params: organizationParams, body: reasonBody.shape.body })), PlatformAdminController.archiveTenant)
router.post('/tenants/:organizationId/restore', authMiddlewares.authSuperAdmin, validateRequest(z.object({ params: organizationParams, body: reasonBody.shape.body })), PlatformAdminController.restoreArchivedTenant)
router.get('/tenants/:organizationId/deletion-preview', authMiddlewares.authSuperAdmin, validateRequest(z.object({ params: organizationParams })), PlatformAdminController.tenantDeletionPreview)
router.post('/tenants/:organizationId/delete', authMiddlewares.authSuperAdmin, validateRequest(deletionBody), PlatformAdminController.scheduleTenantDeletion)
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
