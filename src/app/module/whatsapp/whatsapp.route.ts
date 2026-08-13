import express from 'express'
import { z } from 'zod'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { WhatsAppController } from './whatsapp.controller'
const router = express.Router()
router.get('/deep-link', authMiddlewares.requirePermission('leads.read'), WhatsAppController.link)
router.get('/integration', authMiddlewares.requirePermission('whatsapp.manage'), WhatsAppController.get)
router.put('/integration', authMiddlewares.requirePermission('whatsapp.manage'), validateRequest(z.object({ body: z.object({ businessAccountId: z.string().trim().max(100).optional(), phoneNumberId: z.string().trim().max(100).optional(), displayPhoneNumber: z.string().trim().max(50).optional(), accessToken: z.string().trim().min(20).optional(), status: z.enum(['disabled', 'pending_approval', 'connected']).optional() }) })), WhatsAppController.save)
router.post('/integration/test', authMiddlewares.requirePermission('whatsapp.manage'), WhatsAppController.verify)
router.delete('/integration', authMiddlewares.requirePermission('whatsapp.manage'), WhatsAppController.disable)
router.post('/send-template', authMiddlewares.requirePermission('whatsapp.manage'), validateRequest(z.object({ body: z.object({ phone: z.string().min(8).max(30), templateName: z.string().trim().min(1).max(120), languageCode: z.string().trim().max(20).optional(), components: z.array(z.any()).max(20).optional(), leadId: z.string().optional() }) })), WhatsAppController.sendTemplate)
export const WhatsAppRoute = router
