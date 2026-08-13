import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { publicLeadRateLimiter } from '../../middlewares/rateLimiter'
import validateRequest from '../../middlewares/validateRequest'
import { LeadController } from './lead.controller'
import { LeadValidation } from './lead.validation'
const router=express.Router()
router.post('/public-capture',publicLeadRateLimiter,validateRequest(LeadValidation.publicCaptureZodSchema),LeadController.publicCaptureLead)
router.post('/import/preview',authMiddlewares.requirePermission('leads.write'),validateRequest(LeadValidation.csvSchema),LeadController.previewCsv)
router.post('/import',authMiddlewares.requirePermission('leads.write'),validateRequest(LeadValidation.csvSchema),LeadController.importCsv)
router.get('/export/csv',authMiddlewares.requirePermission('crm.export'),LeadController.exportCsv)
router.get('/',authMiddlewares.requirePermission('leads.read'),LeadController.getAllLeads)
router.post('/',authMiddlewares.requirePermission('leads.write'),validateRequest(LeadValidation.createLeadZodSchema),LeadController.createLead)
router.get('/:id',authMiddlewares.requirePermission('leads.read'),LeadController.getLeadById)
router.patch('/:id',authMiddlewares.requirePermission('leads.write'),validateRequest(LeadValidation.updateLeadZodSchema),LeadController.updateLead)
router.patch('/:id/status',authMiddlewares.requirePermission('leads.write'),validateRequest(LeadValidation.updateLeadStatusZodSchema),LeadController.updateLeadStatus)
router.patch('/:id/assign',authMiddlewares.requirePermission('leads.assign'),LeadController.assignAgent)
router.post('/:id/response',authMiddlewares.requirePermission('leads.write'),LeadController.recordResponse)
router.delete('/:id',authMiddlewares.requirePermission('leads.write'),LeadController.deleteLead)
export const LeadRoute=router
