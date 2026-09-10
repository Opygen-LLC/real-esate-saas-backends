import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { ComplianceController } from './compliance.controller'
import { ComplianceValidation } from './compliance.validation'
import { adminNetworkRateLimiter, adminOperationRateLimiter, exportRateLimiter } from '../../middlewares/rateLimiter'

const router = express.Router()
router.get('/profile', authMiddlewares.auth('agency_owner', 'agency_admin'), ComplianceController.getProfile)
router.patch('/profile', authMiddlewares.auth('agency_owner', 'agency_admin'), validateRequest(ComplianceValidation.profile), ComplianceController.updateProfile)
router.post('/consents', authMiddlewares.auth(), validateRequest(ComplianceValidation.consent), ComplianceController.consent)
router.get('/data-requests', authMiddlewares.auth('agency_owner', 'agency_admin'), ComplianceController.requests)
router.post('/data-requests', authMiddlewares.auth('agency_owner', 'agency_admin'), validateRequest(ComplianceValidation.request), ComplianceController.createRequest)
router.get('/data-requests/:id/export', authMiddlewares.auth('agency_owner', 'agency_admin'), exportRateLimiter, ComplianceController.download)

router.get('/admin/profiles', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, ComplianceController.adminProfiles)
router.get('/admin/data-requests', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, ComplianceController.adminRequests)
router.patch('/admin/profiles/:organizationId', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(ComplianceValidation.reviewProfile), ComplianceController.reviewProfile)
router.patch('/admin/data-requests/:id', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(ComplianceValidation.processRequest), ComplianceController.processRequest)
export const ComplianceRoute = router
