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
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  validateRequest(ViewingValidation.checkConflictZodSchema),
  ViewingController.checkConflict
)

router.get(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'viewer', 'super-admin', 'admin', 'client'),
  ViewingController.getAllViewings
)

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  validateRequest(ViewingValidation.createViewingZodSchema),
  ViewingController.createViewing
)

router.get(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'viewer', 'super-admin', 'admin', 'client'),
  ViewingController.getViewingById
)

router.patch(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  validateRequest(ViewingValidation.updateViewingZodSchema),
  ViewingController.updateViewing
)

router.delete(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  ViewingController.deleteViewing
)

export const ViewingRoute = router
