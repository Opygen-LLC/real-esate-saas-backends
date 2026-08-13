import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { OrganizationController } from './organization.controller'
import validateRequest from '../../middlewares/validateRequest'
import { OrganizationValidation } from './organization.validation'

const router = express.Router()

// Public endpoints to resolve agency website info
router.get('/public-site/:identifier', OrganizationController.getPublicSiteInfo)
router.get('/public/:domain', OrganizationController.getOrganizationByDomain)

// Authenticated agency owner/admin endpoints
router.patch(
  '/website-settings',
  authMiddlewares.requirePermission('website.write'),
  validateRequest(OrganizationValidation.website),
  OrganizationController.updateWebsiteSettings
)

router.get(
  '/',
  authMiddlewares.auth(),
  OrganizationController.getMyOrganization
)

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin'),
  validateRequest(OrganizationValidation.updateProfile),
  OrganizationController.updateMyOrganization
)

router.patch(
  '/update',
  authMiddlewares.auth('agency_owner', 'agency_admin'),
  validateRequest(OrganizationValidation.updateProfile),
  OrganizationController.updateMyOrganization
)

// Super admin endpoints
router.get(
  '/all',
  authMiddlewares.authSuperAdmin,
  OrganizationController.getAllOrganizations
)

router.patch(
  '/:id',
  authMiddlewares.authSuperAdmin,
  validateRequest(OrganizationValidation.platformUpdate),
  OrganizationController.updateOrganizationBySuperAdmin
)

export const OrganizationRoute = router
