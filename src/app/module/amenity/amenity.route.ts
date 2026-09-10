import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { AmenityController } from './amenity.controller'
import validateRequest from '../../middlewares/validateRequest'
import { AmenityValidation } from './amenity.validation'

const router = express.Router()

router.get('/public/:organizationId', validateRequest(AmenityValidation.publicList), AmenityController.getAllAmenities)

router.get(
  '/',
  authMiddlewares.requirePermission('properties.read'),
  AmenityController.getAllAmenities
)

router.post(
  '/',
  authMiddlewares.requirePermission('organization.manage'),
  validateRequest(AmenityValidation.create),
  AmenityController.createAmenity
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('organization.manage'),
  validateRequest(AmenityValidation.id),
  AmenityController.deleteAmenity
)

export const AmenityRoute = router
