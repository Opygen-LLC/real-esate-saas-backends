import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { PropertyController } from './property.controller'
import { PropertyValidation } from './property.validation'

const router = express.Router()

// Public endpoints (no authentication required)
router.get('/public-detail/:id', PropertyController.getPublicPropertyDetail)
router.get('/public/:organizationId', PropertyController.getPublicProperties)
router.get('/public/:organizationId/slug/:slug', PropertyController.getPublicPropertyBySlug)

// Authenticated endpoints
router.get(
  '/',
  authMiddlewares.auth(
    'agency_owner',
    'agency_admin',
    'agent',
    'viewer',
    'super-admin',
    'admin',
    'client',
    'staff'
  ),
  PropertyController.getAllProperties
)

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  validateRequest(PropertyValidation.createPropertyZodSchema),
  PropertyController.createProperty
)

router.get(
  '/:id',
  authMiddlewares.auth(
    'agency_owner',
    'agency_admin',
    'agent',
    'viewer',
    'super-admin',
    'admin',
    'client',
    'staff'
  ),
  PropertyController.getPropertyById
)

router.patch(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  validateRequest(PropertyValidation.updatePropertyZodSchema),
  PropertyController.updateProperty
)

router.patch(
  '/:id/status',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  validateRequest(PropertyValidation.updateStatusZodSchema),
  PropertyController.updatePropertyStatus
)

router.patch(
  '/:id/images/reorder',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'admin', 'client'),
  PropertyController.reorderPropertyImages
)

router.delete(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  PropertyController.deleteProperty
)

export const PropertyRoute = router
