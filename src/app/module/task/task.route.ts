import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { TaskController } from './task.controller'
import { TaskValidation } from './task.validation'

const router = express.Router()

router.get(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'viewer', 'super-admin', 'admin', 'client'),
  TaskController.getAllTasks
)

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  validateRequest(TaskValidation.createTaskZodSchema),
  TaskController.createTask
)

router.patch(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  validateRequest(TaskValidation.updateTaskZodSchema),
  TaskController.updateTask
)

router.delete(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  TaskController.deleteTask
)

router.patch(
  '/:id/approve',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'super-admin'),
  TaskController.approveTask
)

export const TaskRoute = router
