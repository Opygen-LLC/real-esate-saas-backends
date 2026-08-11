import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { AmenityController } from './amenity.controller'

const router = express.Router()

router.get('/public/:organizationId', AmenityController.getAllAmenities)

router.get(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'viewer', 'super-admin', 'admin', 'client', 'staff'),
  AmenityController.getAllAmenities
)

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client', 'super-admin'),
  AmenityController.createAmenity
)

router.delete(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client', 'super-admin'),
  AmenityController.deleteAmenity
)

export const AmenityRoute = router
