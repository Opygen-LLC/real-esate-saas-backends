import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { PlatformAdminController } from './platformAdmin.controller'

const router = express.Router()
const reasonBody = z.object({ body: z.object({ reason: z.string().trim().min(10).max(500) }) })
router.get('/tenants/health', authMiddlewares.authSuperAdmin, PlatformAdminController.tenantHealth)
router.post('/tenants/:organizationId/suspend', authMiddlewares.authSuperAdmin, validateRequest(reasonBody), PlatformAdminController.suspendTenant)
router.post('/tenants/:organizationId/reactivate', authMiddlewares.authSuperAdmin, validateRequest(reasonBody), PlatformAdminController.reactivateTenant)
router.get('/payments', authMiddlewares.authSuperAdmin, PlatformAdminController.paymentLedger)
router.post('/payments/:paymentId/notes', authMiddlewares.authSuperAdmin, validateRequest(z.object({ body: z.object({ note: z.string().trim().min(5).max(1000) }) })), PlatformAdminController.addPaymentNote)
router.get('/revenue', authMiddlewares.authSuperAdmin, PlatformAdminController.revenue)
router.get('/audit', authMiddlewares.authSuperAdmin, PlatformAdminController.audit)
router.post('/impersonation/start', authMiddlewares.authSuperAdmin, validateRequest(z.object({ body: z.object({ organizationId: z.string().trim().min(3).max(100), targetUserId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(), reason: z.string().trim().min(10).max(500), durationMinutes: z.number().int().min(5).max(30).optional() }) })), PlatformAdminController.startImpersonation)
// Ending must remain callable while the request is authenticated as the impersonated tenant.
router.post('/impersonation/end', PlatformAdminController.endImpersonation)

export const PlatformAdminRoute = router
