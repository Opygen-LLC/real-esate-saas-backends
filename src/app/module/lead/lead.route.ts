import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { LeadController } from './lead.controller'
import { LeadValidation } from './lead.validation'

const router = express.Router()

import { publicLeadRateLimiter } from '../../middlewares/rateLimiter'

// Public Lead Capture endpoint (Rate limited)
router.post('/public-capture', publicLeadRateLimiter, LeadController.publicCaptureLead)

// Authenticated CRM endpoints
router.get(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'viewer', 'super-admin', 'admin', 'client'),
  LeadController.getAllLeads
)

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  validateRequest(LeadValidation.createLeadZodSchema),
  LeadController.createLead
)

router.get(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'viewer', 'super-admin', 'admin', 'client'),
  LeadController.getLeadById
)

router.patch(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  validateRequest(LeadValidation.updateLeadZodSchema),
  LeadController.updateLead
)

router.patch(
  '/:id/status',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  validateRequest(LeadValidation.updateLeadStatusZodSchema),
  LeadController.updateLeadStatus
)

router.patch(
  '/:id/assign',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  LeadController.assignAgent
)

router.delete(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  LeadController.deleteLead
)

export const LeadRoute = router
