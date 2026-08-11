import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { PropertyTypeController } from './propertyType.controller'

const router = express.Router()

router.get('/public/:organizationId', PropertyTypeController.getAllPropertyTypes)

router.get(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'viewer', 'super-admin', 'admin', 'client', 'staff'),
  PropertyTypeController.getAllPropertyTypes
)

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client', 'super-admin'),
  PropertyTypeController.createPropertyType
)

router.delete(
  '/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client', 'super-admin'),
  PropertyTypeController.deletePropertyType
)

export const PropertyTypeRoute = router
