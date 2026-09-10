import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { publicLeadRateLimiter } from '../../middlewares/rateLimiter'
import validateRequest from '../../middlewares/validateRequest'
import { ModerationController } from './moderation.controller'
import { ModerationValidation } from './moderation.validation'

const router = express.Router()
router.post('/fraud-reports', publicLeadRateLimiter, validateRequest(ModerationValidation.report), ModerationController.reportFraud)
router.get('/admin/listings', authMiddlewares.authSuperAdmin, validateRequest(ModerationValidation.listingQueue), ModerationController.listings)
router.patch('/admin/listings/:id', authMiddlewares.authSuperAdmin, validateRequest(ModerationValidation.listing), ModerationController.reviewListing)
router.get('/admin/fraud-reports', authMiddlewares.authSuperAdmin, validateRequest(ModerationValidation.reportQueue), ModerationController.reports)
router.patch('/admin/fraud-reports/:id', authMiddlewares.authSuperAdmin, validateRequest(ModerationValidation.reportReview), ModerationController.reviewReport)
router.get('/admin/audit-history', authMiddlewares.authSuperAdmin, validateRequest(ModerationValidation.auditHistory), ModerationController.auditHistory)
export const ModerationRoute = router
