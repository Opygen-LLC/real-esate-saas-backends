import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { generalApiRateLimiter, publicLeadRateLimiter } from '../../middlewares/rateLimiter'
import { ReviewController } from './review.controller'
import { ReviewValidation } from './review.validation'

const router = express.Router()
router.get('/public/invite/:token', generalApiRateLimiter, validateRequest(ReviewValidation.invitationToken), ReviewController.getInvitation)
router.post('/public/submit', publicLeadRateLimiter, validateRequest(ReviewValidation.submit), ReviewController.submit)
router.get('/public/organization/:organizationId', generalApiRateLimiter, validateRequest(ReviewValidation.publicOrganization), ReviewController.publicReviews)
router.get('/', authMiddlewares.requirePermission('website.write'), ReviewController.list)
router.post('/invitations', authMiddlewares.requirePermission('website.write'), validateRequest(ReviewValidation.createInvitation), ReviewController.createInvitation)
router.patch('/invitations/:id/revoke', authMiddlewares.requirePermission('website.write'), validateRequest(ReviewValidation.id), ReviewController.revokeInvitation)
router.patch('/:id', authMiddlewares.requirePermission('website.write'), validateRequest(ReviewValidation.moderate), ReviewController.moderate)
router.delete('/:id', authMiddlewares.requirePermission('website.write'), validateRequest(ReviewValidation.id), ReviewController.remove)
export const ReviewRoute = router
