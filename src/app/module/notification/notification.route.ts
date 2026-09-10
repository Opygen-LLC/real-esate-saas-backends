import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { NotificationController } from './notification.controller'
import validateRequest from '../../middlewares/validateRequest'
import { NotificationValidation } from './notification.validation'

const router = express.Router()

// Notifications belong to the authenticated user, not to the Leads feature.
// Tenant + user scoping is enforced again in every service query.
router.use(authMiddlewares.auth())
router.get('/', validateRequest(NotificationValidation.list), NotificationController.list)
router.patch('/read-all', NotificationController.markAllRead)
router.patch('/:id/read', validateRequest(NotificationValidation.id), NotificationController.markRead)
router.delete('/:id', validateRequest(NotificationValidation.id), NotificationController.dismiss)

export const NotificationRoute = router
