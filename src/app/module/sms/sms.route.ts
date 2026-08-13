import express from 'express'
import { z } from 'zod'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { SmsController } from './sms.controller'

const router = express.Router()
const sendSchema = z.object({ body: z.object({ phone: z.string().min(8).max(30), message: z.string().trim().min(1).max(480).optional(), templateKey: z.string().trim().min(1).max(80).optional(), variables: z.record(z.string().max(200)).optional(), leadId: z.string().optional() }).refine(v => Boolean(v.message || v.templateKey), 'message or templateKey is required') })
const templateSchema = z.object({ body: z.object({ key: z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/), name: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(480), isActive: z.boolean().optional() }) })
const optSchema = z.object({ body: z.object({ phone: z.string().min(8).max(30), reason: z.string().max(120).optional() }) })
router.post('/delivery-receipt', (req, _res, next) => { const secret = req.headers['x-sms-webhook-secret']; if (config.sms.webhook_secret && secret !== config.sms.webhook_secret) return next(new ApiError(401, 'Invalid SMS webhook signature')); next() }, SmsController.receipt)
router.post('/send', authMiddlewares.requirePermission('messaging.manage'), validateRequest(sendSchema), SmsController.send)
router.get('/templates', authMiddlewares.requirePermission('messaging.manage'), SmsController.templates)
router.put('/templates', authMiddlewares.requirePermission('messaging.manage'), validateRequest(templateSchema), SmsController.upsertTemplate)
router.post('/opt-out', authMiddlewares.requirePermission('messaging.manage'), validateRequest(optSchema), SmsController.optOut)
router.post('/opt-in', authMiddlewares.requirePermission('messaging.manage'), validateRequest(optSchema), SmsController.optIn)
router.get('/usage', authMiddlewares.requirePermission('messaging.manage'), SmsController.usage)
export const SmsRoute = router
