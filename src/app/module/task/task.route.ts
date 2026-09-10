import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { TaskController } from './task.controller'
import { TaskValidation } from './task.validation'

const router = express.Router()


router.get(
  '/summary',
  authMiddlewares.requirePermission('tasks.read'),
  TaskController.getTaskSummary
)

router.get(
  '/',
  authMiddlewares.requirePermission('tasks.read'),
  validateRequest(TaskValidation.listTasksZodSchema),
  TaskController.getAllTasks
)

router.post(
  '/',
  authMiddlewares.requirePermission('tasks.write'),
  validateRequest(TaskValidation.createTaskZodSchema),
  TaskController.createTask
)

router.patch(
  '/:id',
  authMiddlewares.requirePermission('tasks.write'),
  validateRequest(TaskValidation.updateTaskZodSchema),
  TaskController.updateTask
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('tasks.write'),
  validateRequest(TaskValidation.taskIdZodSchema),
  TaskController.deleteTask
)

router.patch(
  '/:id/approve',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'super-admin'),
  validateRequest(TaskValidation.approveTaskZodSchema),
  TaskController.approveTask
)

export const TaskRoute = router
