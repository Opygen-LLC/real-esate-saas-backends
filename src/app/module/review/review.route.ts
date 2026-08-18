import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { generalApiRateLimiter, publicLeadRateLimiter } from '../../middlewares/rateLimiter'
import { ReviewController } from './review.controller'
import { ReviewValidation } from './review.validation'

const router = express.Router()
router.get('/public/invite/:token', generalApiRateLimiter, ReviewController.getInvitation)
router.post('/public/submit', publicLeadRateLimiter, validateRequest(ReviewValidation.submit), ReviewController.submit)
router.get('/public/organization/:organizationId', generalApiRateLimiter, ReviewController.publicReviews)
router.get('/', authMiddlewares.auth('agency_owner', 'agency_admin'), ReviewController.list)
router.post('/invitations', authMiddlewares.auth('agency_owner', 'agency_admin'), validateRequest(ReviewValidation.createInvitation), ReviewController.createInvitation)
router.patch('/invitations/:id/revoke', authMiddlewares.auth('agency_owner', 'agency_admin'), ReviewController.revokeInvitation)
router.patch('/:id', authMiddlewares.auth('agency_owner', 'agency_admin'), validateRequest(ReviewValidation.moderate), ReviewController.moderate)
router.delete('/:id', authMiddlewares.auth('agency_owner', 'agency_admin'), ReviewController.remove)
export const ReviewRoute = router
