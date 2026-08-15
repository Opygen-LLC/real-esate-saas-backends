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
// Property media uses property permissions while reusing the hardened storage pipeline.
router.post('/assets/presign', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.presignImageZodSchema), PropertyController.presignPropertyImage)
router.post('/assets/complete', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.completeImageZodSchema), PropertyController.completePropertyImage)
router.post('/assets/import-url', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.importImageUrlZodSchema), PropertyController.importPropertyImageUrl)
router.get('/assets/:assetId', authMiddlewares.requirePermission('properties.write'), PropertyController.getPropertyImageAsset)

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
  authMiddlewares.requirePermission('properties.publish'),
  validateRequest(PropertyValidation.updateStatusZodSchema),
  PropertyController.updatePropertyStatus
)

router.patch(
  '/:id/images/reorder',
  authMiddlewares.requirePermission('properties.write'),
  validateRequest(PropertyValidation.reorderImagesZodSchema),
  PropertyController.reorderPropertyImages
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('properties.delete'),
  PropertyController.deleteProperty
)

export const PropertyRoute = router
