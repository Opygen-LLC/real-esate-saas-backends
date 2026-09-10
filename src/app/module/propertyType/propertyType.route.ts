import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { PropertyTypeController } from './propertyType.controller'
import validateRequest from '../../middlewares/validateRequest'
import { PropertyTypeValidation } from './propertyType.validation'

const router = express.Router()

router.get('/public/:organizationId', validateRequest(PropertyTypeValidation.publicList), PropertyTypeController.getAllPropertyTypes)

router.get(
  '/',
  authMiddlewares.requirePermission('properties.read'),
  PropertyTypeController.getAllPropertyTypes
)

router.post(
  '/',
  authMiddlewares.requirePermission('organization.manage'),
  validateRequest(PropertyTypeValidation.create),
  PropertyTypeController.createPropertyType
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('organization.manage'),
  validateRequest(PropertyTypeValidation.id),
  PropertyTypeController.deletePropertyType
)

export const PropertyTypeRoute = router
