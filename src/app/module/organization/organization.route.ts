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
  '/branding',
  authMiddlewares.requirePermission('website.write'),
  validateRequest(OrganizationValidation.branding),
  OrganizationController.updateBrandingSettings
)

router.patch(
  '/website-settings',
  authMiddlewares.requirePermission('website.write'),
  validateRequest(OrganizationValidation.website),
  OrganizationController.updateWebsiteSettings
)

router.patch(
  '/onboarding',
  authMiddlewares.requirePermission('organization.manage'),
  validateRequest(OrganizationValidation.onboarding),
  OrganizationController.saveOnboarding
)

router.post(
  '/onboarding/complete',
  authMiddlewares.requirePermission('organization.manage'),
  OrganizationController.completeOnboarding
)

router.post(
  '/onboarding/skip',
  authMiddlewares.requirePermission('organization.manage'),
  OrganizationController.skipOnboarding
)

router.get(
  '/',
  authMiddlewares.auth(),
  OrganizationController.getMyOrganization
)

router.post(
  '/',
  authMiddlewares.requirePermission('organization.manage'),
  validateRequest(OrganizationValidation.updateProfile),
  OrganizationController.updateMyOrganization
)

router.patch(
  '/update',
  authMiddlewares.requirePermission('organization.manage'),
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
