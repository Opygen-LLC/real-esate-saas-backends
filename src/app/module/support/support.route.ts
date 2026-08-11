import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { SupportController } from './support.controller'

const router = express.Router()

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

export const SupportRoute = router
