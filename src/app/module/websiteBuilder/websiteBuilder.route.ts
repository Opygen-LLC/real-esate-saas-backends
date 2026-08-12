import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { WebsiteBuilderController } from './websiteBuilder.controller'

const router = express.Router()

// Public endpoint to render published builder pages
router.get(
  '/public-site/:subdomain/pages/:slug?',
  WebsiteBuilderController.getPublicPage
)

// Authenticated builder endpoints (Agency Owner / Admin)
router.get(
  '/pages',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client', 'super-admin'),
  WebsiteBuilderController.getAllPages
)

router.get(
  '/pages/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client', 'super-admin'),
  WebsiteBuilderController.getPageById
)

router.put(
  '/pages/:id/draft',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client', 'super-admin'),
  WebsiteBuilderController.saveDraft
)

router.post(
  '/pages/:id/publish',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client', 'super-admin'),
  WebsiteBuilderController.publishPage
)

router.post(
  '/assets',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client', 'super-admin'),
  WebsiteBuilderController.addAsset
)

router.delete(
  '/assets/:id',
  authMiddlewares.auth('agency_owner', 'agency_admin', 'admin', 'client', 'super-admin'),
  WebsiteBuilderController.deleteAsset
)

export const WebsiteBuilderRoute = router
