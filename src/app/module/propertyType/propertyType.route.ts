import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { PropertyTypeController } from './propertyType.controller'

const router = express.Router()

router.get('/public/:organizationId', PropertyTypeController.getAllPropertyTypes)

router.get(
  '/',
  authMiddlewares.requirePermission('properties.read'),
  PropertyTypeController.getAllPropertyTypes
)

router.post(
  '/',
  authMiddlewares.requirePermission('organization.manage'),
  PropertyTypeController.createPropertyType
)

router.delete(
  '/:id',
  authMiddlewares.requirePermission('organization.manage'),
  PropertyTypeController.deletePropertyType
)

export const PropertyTypeRoute = router
