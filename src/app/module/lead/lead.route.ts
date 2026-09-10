import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { exportRateLimiter, leadImportRateLimiter, publicLeadRateLimiter } from '../../middlewares/rateLimiter'
import validateRequest from '../../middlewares/validateRequest'
import { LeadController } from './lead.controller'
import { LeadValidation } from './lead.validation'
import { leadImportUpload } from './leadImport.middleware'
import { ActivityValidation } from '../activity/activity.validation'

const router=express.Router()
router.post('/public-capture',publicLeadRateLimiter,validateRequest(LeadValidation.publicCaptureZodSchema),LeadController.publicCaptureLead)
router.get('/import/template.csv',authMiddlewares.requirePermission('leads.write'),LeadController.downloadImportCsvTemplate)
router.get('/import/template.xlsx',authMiddlewares.requirePermission('leads.write'),LeadController.downloadImportXlsxTemplate)
router.post('/import/preview',authMiddlewares.requirePermission('leads.write'),leadImportRateLimiter,leadImportUpload,LeadController.previewImport)
router.post('/import/confirm',authMiddlewares.requirePermission('leads.write'),leadImportRateLimiter,validateRequest(LeadValidation.confirmImportZodSchema),LeadController.confirmImport)
router.get('/export/csv',authMiddlewares.requirePermission('leads.read'),authMiddlewares.requirePermission('crm.export'),exportRateLimiter,LeadController.exportCsv)
router.get('/export/xlsx',authMiddlewares.requirePermission('leads.read'),authMiddlewares.requirePermission('crm.export'),exportRateLimiter,LeadController.exportXlsx)
router.get('/today-followups',authMiddlewares.requirePermission('leads.read'),LeadController.getTodayFollowUps)
router.get('/',authMiddlewares.requirePermission('leads.read'),LeadController.getAllLeads)
router.post('/',authMiddlewares.requirePermission('leads.write'),validateRequest(LeadValidation.createLeadZodSchema),LeadController.createLead)
router.get('/:id/history',authMiddlewares.requirePermission('leads.read'),validateRequest(LeadValidation.leadIdZodSchema),LeadController.getHistory)
router.post('/:id/notes',authMiddlewares.requirePermission('leads.write'),validateRequest(ActivityValidation.appendNoteZodSchema),validateRequest(LeadValidation.leadIdZodSchema),LeadController.addNote)
router.get('/:id',authMiddlewares.requirePermission('leads.read'),validateRequest(LeadValidation.leadIdZodSchema),LeadController.getLeadById)
router.patch('/:id',authMiddlewares.requirePermission('leads.write'),validateRequest(LeadValidation.leadIdZodSchema),validateRequest(LeadValidation.updateLeadZodSchema),LeadController.updateLead)
router.patch('/:id/manage',authMiddlewares.requirePermission('leads.write'),validateRequest(LeadValidation.leadIdZodSchema),validateRequest(LeadValidation.manageLeadZodSchema),LeadController.manageLead)
router.patch('/:id/status',authMiddlewares.requirePermission('leads.write'),validateRequest(LeadValidation.leadIdZodSchema),validateRequest(LeadValidation.updateLeadStatusZodSchema),LeadController.updateLeadStatus)
router.patch('/:id/assign',authMiddlewares.requirePermission('leads.assign'),validateRequest(LeadValidation.leadIdZodSchema),validateRequest(LeadValidation.assignLeadAgentZodSchema),LeadController.assignAgent)
router.patch('/:id/follow-up',authMiddlewares.requirePermission('leads.write'),validateRequest(LeadValidation.leadIdZodSchema),validateRequest(LeadValidation.scheduleLeadFollowUpZodSchema),LeadController.scheduleFollowUp)
router.post('/:id/follow-up/complete',authMiddlewares.requirePermission('leads.write'),validateRequest(LeadValidation.leadIdZodSchema),validateRequest(LeadValidation.completeLeadFollowUpZodSchema),LeadController.completeFollowUp)
router.post('/:id/reengage',authMiddlewares.requirePermission('leads.write'),validateRequest(LeadValidation.leadIdZodSchema),validateRequest(LeadValidation.reengageLeadZodSchema),LeadController.reengageLead)
router.post('/:id/response',authMiddlewares.requirePermission('leads.write'),validateRequest(LeadValidation.leadIdZodSchema),LeadController.recordResponse)
router.delete('/:id',authMiddlewares.requirePermission('leads.write'),validateRequest(LeadValidation.leadIdZodSchema),LeadController.deleteLead)
export const LeadRoute=router
