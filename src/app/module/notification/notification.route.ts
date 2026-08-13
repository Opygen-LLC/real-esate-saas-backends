import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { NotificationController } from './notification.controller'
const router = express.Router()
router.get('/', authMiddlewares.requirePermission('leads.read'), NotificationController.list)
router.patch('/read-all', authMiddlewares.requirePermission('leads.read'), NotificationController.markAllRead)
router.patch('/:id/read', authMiddlewares.requirePermission('leads.read'), NotificationController.markRead)
export const NotificationRoute = router
