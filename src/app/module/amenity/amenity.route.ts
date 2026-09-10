import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { AmenityController } from './amenity.controller'

const router = express.Router()

router.get('/public/:organizationId', AmenityController.getAllAmenities)

router.get(
  '/',
  authMiddlewares.requirePermission('properties.read'),
  AmenityController.getAllAmenities
)

router.post(
  '/',
  authMiddlewares.requirePermission('organization.manage'),
  AmenityController.createAmenity
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('organization.manage'),
  AmenityController.deleteAmenity
)

export const AmenityRoute = router
