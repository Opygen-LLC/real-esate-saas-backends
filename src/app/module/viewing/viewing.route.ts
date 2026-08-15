import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { ViewingController } from './viewing.controller'
import { ViewingValidation } from './viewing.validation'

const router = express.Router()

// Public Viewing Request
router.post('/public-request', validateRequest(ViewingValidation.publicRequestZodSchema), ViewingController.publicRequestViewing)

// Authenticated viewing endpoints
router.post(
  '/check-conflict',
  authMiddlewares.requirePermission('viewings.write'),
  validateRequest(ViewingValidation.checkConflictZodSchema),
  ViewingController.checkConflict
)

router.get(
  '/',
  authMiddlewares.requirePermission('viewings.read'),
  ViewingController.getAllViewings
)

router.post(
  '/',
  authMiddlewares.requirePermission('viewings.write'),
  validateRequest(ViewingValidation.createViewingZodSchema),
  ViewingController.createViewing
)

router.get(
  '/:id',
  authMiddlewares.requirePermission('viewings.read'),
  ViewingController.getViewingById
)

router.patch(
  '/:id',
  authMiddlewares.requirePermission('viewings.write'),
  validateRequest(ViewingValidation.updateViewingZodSchema),
  ViewingController.updateViewing
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('viewings.write'),
  ViewingController.deleteViewing
)

export const ViewingRoute = router
