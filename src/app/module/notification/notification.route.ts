import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { NotificationController } from './notification.controller'

const router = express.Router()

// Notifications belong to the authenticated user, not to the Leads feature.
// Tenant + user scoping is enforced again in every service query.
router.use(authMiddlewares.auth())
router.get('/', NotificationController.list)
router.patch('/read-all', NotificationController.markAllRead)
router.patch('/:id/read', NotificationController.markRead)
router.delete('/:id', NotificationController.dismiss)

export const NotificationRoute = router
