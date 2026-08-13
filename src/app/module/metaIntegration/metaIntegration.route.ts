import express from 'express'
import { z } from 'zod'
import validateRequest from '../../middlewares/validateRequest'
import { authMiddlewares } from '../../middlewares/auth'
import { MetaIntegrationController } from './metaIntegration.controller'
import { generalApiRateLimiter } from '../../middlewares/rateLimiter'

const router = express.Router()
const eventNames = z.enum(['PageView', 'ViewContent', 'Search', 'Lead', 'Contact', 'Schedule'])
router.get('/public/:identifier/config', MetaIntegrationController.publicConfig)
router.post('/public/:identifier/events', generalApiRateLimiter, validateRequest(z.object({ body: z.object({ eventName: eventNames, eventId: z.string().min(8).max(120), eventSourceUrl: z.string().url().max(2048), consent: z.boolean().optional(), userData: z.object({ email: z.string().email().optional(), phone: z.string().max(40).optional(), firstName: z.string().max(80).optional(), lastName: z.string().max(80).optional(), fbp: z.string().max(255).optional(), fbc: z.string().max(255).optional() }).optional(), customData: z.record(z.any()).optional() }) })), MetaIntegrationController.capture)
router.get('/', authMiddlewares.requirePermission('website.write'), MetaIntegrationController.get)
router.put('/', authMiddlewares.requirePermission('website.write'), validateRequest(z.object({ body: z.object({ pixelId: z.string().regex(/^\d{5,30}$/), accessToken: z.string().max(4096).optional(), testEventCode: z.string().max(100).optional(), status: z.enum(['active', 'disabled']).optional(), consentRequired: z.boolean().optional(), enableSchedule: z.boolean().optional() }) })), MetaIntegrationController.save)
router.post('/test', authMiddlewares.requirePermission('website.write'), validateRequest(z.object({ body: z.object({ eventSourceUrl: z.string().url().max(2048) }) })), MetaIntegrationController.test)
router.get('/dead-letters', authMiddlewares.requirePermission('website.write'), MetaIntegrationController.deadLetters)
router.post('/dead-letters/:id/retry', authMiddlewares.requirePermission('website.write'), MetaIntegrationController.retryDead)
export const MetaIntegrationRoute = router
