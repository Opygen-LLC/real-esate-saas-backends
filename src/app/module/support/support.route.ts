import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { SupportController } from './support.controller'

const router = express.Router()

router.get(
  '/all',
  authMiddlewares.auth('super-admin'),
  SupportController.getAllTicketsSuperAdmin
)

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'super-admin', 'admin', 'client', 'staff'),
  SupportController.createTicket
)

router.get(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'super-admin', 'admin', 'client', 'staff'),
  SupportController.getMyTickets
)

router.post(
  '/:id/reply',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'super-admin', 'admin', 'client', 'staff'),
  SupportController.replyToTicket
)

router.patch(
  '/:id/status',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'super-admin', 'admin'),
  SupportController.updateTicketStatus
)

export const SupportRoute = router
