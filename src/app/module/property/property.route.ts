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
  authMiddlewares.requirePermission('properties.read'),
  PropertyController.getAllProperties
)

router.post(
  '/',
  authMiddlewares.requirePermission('properties.write'),
  validateRequest(PropertyValidation.createPropertyZodSchema),
  PropertyController.createProperty
)

router.get(
  '/:id',
  authMiddlewares.requirePermission('properties.read'),
  PropertyController.getPropertyById
)

router.patch(
  '/:id',
  authMiddlewares.requirePermission('properties.write'),
  validateRequest(PropertyValidation.updatePropertyZodSchema),
  PropertyController.updateProperty
)

router.patch(
  '/:id/status',
  authMiddlewares.requirePermission('properties.write'),
  validateRequest(PropertyValidation.updateStatusZodSchema),
  PropertyController.updatePropertyStatus
)

router.patch(
  '/:id/images/reorder',
  authMiddlewares.requirePermission('properties.write'),
  PropertyController.reorderPropertyImages
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('properties.delete'),
  PropertyController.deleteProperty
)

export const PropertyRoute = router
