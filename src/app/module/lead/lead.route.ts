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
  authMiddlewares.requirePermission('leads.read'),
  LeadController.getAllLeads
)

router.post(
  '/',
  authMiddlewares.requirePermission('leads.write'),
  validateRequest(LeadValidation.createLeadZodSchema),
  LeadController.createLead
)

router.get(
  '/:id',
  authMiddlewares.requirePermission('leads.read'),
  LeadController.getLeadById
)

router.patch(
  '/:id',
  authMiddlewares.requirePermission('leads.write'),
  validateRequest(LeadValidation.updateLeadZodSchema),
  LeadController.updateLead
)

router.patch(
  '/:id/status',
  authMiddlewares.requirePermission('leads.write'),
  validateRequest(LeadValidation.updateLeadStatusZodSchema),
  LeadController.updateLeadStatus
)

router.patch(
  '/:id/assign',
  authMiddlewares.requirePermission('leads.assign'),
  LeadController.assignAgent
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('leads.write'),
  LeadController.deleteLead
)

export const LeadRoute = router
