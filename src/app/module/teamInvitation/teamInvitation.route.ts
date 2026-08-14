import express from 'express'
import { z } from 'zod'
import validateRequest from '../../middlewares/validateRequest'
import { authMiddlewares } from '../../middlewares/auth'
import { TeamInvitationController } from './teamInvitation.controller'
import { strongPasswordSchema } from '../auth/auth.validation'

const router = express.Router()
const bdPhone = z.string().trim().min(8).max(30)
router.post('/accept', validateRequest(z.object({ body: z.object({ token: z.string().min(20).max(200), password: strongPasswordSchema }).strict() })), TeamInvitationController.accept)
router.get('/pending', authMiddlewares.requirePermission('users.read'), TeamInvitationController.pending)
router.post('/', authMiddlewares.requirePermission('users.write'), validateRequest(z.object({ body: z.object({ name: z.string().trim().min(2).max(100), email: z.string().email(), phoneNumber: bdPhone, userRole: z.enum(['agency_admin', 'agent', 'viewer']).default('agent'), specialization: z.array(z.string().max(80)).max(20).optional() }).strict() })), TeamInvitationController.invite)
export const TeamInvitationRoute = router
