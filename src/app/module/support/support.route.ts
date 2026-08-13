import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { SupportController } from './support.controller'
import validateRequest from '../../middlewares/validateRequest'
import { z } from 'zod'

const router = express.Router()

router.get(
  '/all',
  authMiddlewares.authSuperAdmin,
  SupportController.getAllTicketsSuperAdmin
)

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent'),
  validateRequest(z.object({ body: z.object({ subject: z.string().trim().min(3).max(200), description: z.string().trim().min(1).max(5000),
    category: z.string().max(80).optional(), priority: z.enum(['low', 'medium', 'high', 'urgent']).optional() }) })),
  SupportController.createTicket
)

router.get(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent'),
  SupportController.getMyTickets
)

router.post(
  '/:id/reply',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'super-admin'),
  validateRequest(z.object({ body: z.object({ message: z.string().trim().min(1).max(5000) }) })),
  SupportController.replyToTicket
)

router.patch(
  '/:id/status',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'super-admin'),
  validateRequest(z.object({ body: z.object({ status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional() }).refine(value => value.status || value.priority) })),
  SupportController.updateTicketStatus
)

export const SupportRoute = router
