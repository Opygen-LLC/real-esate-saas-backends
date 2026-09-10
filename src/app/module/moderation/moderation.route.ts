import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { adminNetworkRateLimiter, adminOperationRateLimiter, publicLeadRateLimiter } from '../../middlewares/rateLimiter'
import validateRequest from '../../middlewares/validateRequest'
import { ModerationController } from './moderation.controller'
import { ModerationValidation } from './moderation.validation'

const router = express.Router()
router.post('/fraud-reports', publicLeadRateLimiter, validateRequest(ModerationValidation.report), ModerationController.reportFraud)
router.get('/admin/listings', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(ModerationValidation.listingQueue), ModerationController.listings)
router.patch('/admin/listings/:id', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(ModerationValidation.listing), ModerationController.reviewListing)
router.get('/admin/fraud-reports', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(ModerationValidation.reportQueue), ModerationController.reports)
router.patch('/admin/fraud-reports/:id', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(ModerationValidation.reportReview), ModerationController.reviewReport)
router.get('/admin/audit-history', adminNetworkRateLimiter, authMiddlewares.authSuperAdmin, adminOperationRateLimiter, validateRequest(ModerationValidation.auditHistory), ModerationController.auditHistory)
export const ModerationRoute = router
