import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { OrganizationController } from './organization.controller'

const router = express.Router()

// Public endpoints to resolve agency website info
router.get('/public-site/:identifier', OrganizationController.getPublicSiteInfo)
router.get('/public/:domain', OrganizationController.getOrganizationByDomain)

// Authenticated agency owner/admin endpoints
router.patch(
  '/website-settings',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  OrganizationController.updateWebsiteSettings
)

router.get(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'agent', 'viewer', 'super-admin', 'admin', 'client', 'staff'),
  OrganizationController.getMyOrganization
)

router.post(
  '/',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
  OrganizationController.updateMyOrganization
)

router.patch(
  '/update',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client'),
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
  OrganizationController.updateOrganizationBySuperAdmin
)

export const OrganizationRoute = router
