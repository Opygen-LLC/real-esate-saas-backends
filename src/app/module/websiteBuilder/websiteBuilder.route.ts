import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { WebsiteBuilderController } from './websiteBuilder.controller'
import validateRequest from '../../middlewares/validateRequest'
import { WebsiteBuilderValidation } from './websiteBuilder.validation'

const router = express.Router()

// Public endpoint to render published builder pages
router.get(
  '/public-site/:subdomain/pages/:slug?',
  WebsiteBuilderController.getPublicPage
)

// Authenticated builder endpoints (Agency Owner / Admin)
router.get(
  '/pages',
  authMiddlewares.auth(),
  WebsiteBuilderController.getAllPages
)

router.get(
  '/pages/:id',
  authMiddlewares.auth(),
  WebsiteBuilderController.getPageById
)

router.put(
  '/pages/:id/draft',
  authMiddlewares.requirePermission('website.write'),
  validateRequest(WebsiteBuilderValidation.saveDraftSchema),
  WebsiteBuilderController.saveDraft
)

router.post(
  '/pages/:id/publish',
  authMiddlewares.requirePermission('website.write'),
  WebsiteBuilderController.publishPage
)

router.post(
  '/assets',
  authMiddlewares.requirePermission('website.write'),
  validateRequest(WebsiteBuilderValidation.assetSchema),
  WebsiteBuilderController.addAsset
)

router.delete(
  '/assets/:id',
  authMiddlewares.requirePermission('website.write'),
  WebsiteBuilderController.deleteAsset
)

export const WebsiteBuilderRoute = router
