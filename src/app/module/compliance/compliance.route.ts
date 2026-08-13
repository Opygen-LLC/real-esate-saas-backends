import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { ComplianceController } from './compliance.controller'
import { ComplianceValidation } from './compliance.validation'

const router = express.Router()
router.get('/profile', authMiddlewares.requirePermission('compliance.read'), ComplianceController.getProfile)
router.patch('/profile', authMiddlewares.requirePermission('compliance.write'), validateRequest(ComplianceValidation.profile), ComplianceController.updateProfile)
router.post('/consents', authMiddlewares.auth(), validateRequest(ComplianceValidation.consent), ComplianceController.consent)
router.get('/data-requests', authMiddlewares.requirePermission('compliance.read'), ComplianceController.requests)
router.post('/data-requests', authMiddlewares.requirePermission('compliance.write'), validateRequest(ComplianceValidation.request), ComplianceController.createRequest)
router.get('/data-requests/:id/export', authMiddlewares.requirePermission('compliance.read'), ComplianceController.download)
router.get('/admin/profiles', authMiddlewares.authSuperAdmin, ComplianceController.adminProfiles)
router.get('/admin/data-requests', authMiddlewares.authSuperAdmin, ComplianceController.adminRequests)
router.patch('/admin/profiles/:organizationId', authMiddlewares.authSuperAdmin, validateRequest(ComplianceValidation.reviewProfile), ComplianceController.reviewProfile)
router.patch('/admin/data-requests/:id', authMiddlewares.authSuperAdmin, validateRequest(ComplianceValidation.processRequest), ComplianceController.processRequest)
export const ComplianceRoute = router
