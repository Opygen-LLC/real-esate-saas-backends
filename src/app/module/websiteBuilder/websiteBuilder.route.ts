import { WebsiteStudioController } from './websiteStudio.controller'
import { WebsiteStudioValidation } from './websiteStudio.validation'
import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { WebsiteBuilderController } from './websiteBuilder.controller'
import { WebsiteBuilderValidation } from './websiteBuilder.validation'

const router = express.Router()

// All Studio reads and writes are tenant-scoped and require the same explicit permission.
router.get('/studio', authMiddlewares.requirePermission('website.write'), WebsiteStudioController.state)
router.put('/studio/draft', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteStudioValidation.save), WebsiteStudioController.save)
router.post('/studio/publish', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteStudioValidation.publish), WebsiteStudioController.publish)
router.post('/studio/restore', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteStudioValidation.restore), WebsiteStudioController.restore)
router.post('/studio/reset', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteStudioValidation.reset), WebsiteStudioController.reset)
router.get('/studio/history', authMiddlewares.requirePermission('website.write'), WebsiteStudioController.history)
router.get('/studio/preview', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteStudioValidation.preview), WebsiteStudioController.preview)
router.get('/studio/assets', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteStudioValidation.assets), WebsiteStudioController.assets)
router.get('/assets/:id/usage', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.pageParamsSchema), WebsiteStudioController.assetUsage)


router.get('/design-registry', authMiddlewares.requirePermission('website.write'), WebsiteBuilderController.getDesignRegistry)
router.get('/design', authMiddlewares.requirePermission('website.write'), WebsiteBuilderController.getDesignState)
router.patch('/design', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.designActionSchema), WebsiteBuilderController.applyDesignAction)
router.get('/templates', WebsiteBuilderController.getTemplates)
router.get('/components', WebsiteBuilderController.getComponents)
router.get('/animations', WebsiteBuilderController.getAnimations)
router.get('/public-site/:identifier/sitemap.xml', WebsiteBuilderController.sitemap)
router.get('/public-site/:identifier/robots.txt', WebsiteBuilderController.robots)
router.get('/public-site/:identifier/share-card/:propertyId', WebsiteBuilderController.propertyShareCard)
router.get('/public-site/:identifier/pages/:slug?', WebsiteBuilderController.getPublicPage)
router.get('/preview/:token', WebsiteBuilderController.getPreview)
router.get('/pages', authMiddlewares.requirePermission('website.write'), WebsiteBuilderController.getAllPages)
router.get('/pages/:id', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.pageParamsSchema), WebsiteBuilderController.getPageById)
router.put('/pages/:id/draft', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.pageParamsSchema), validateRequest(WebsiteBuilderValidation.saveDraftSchema), WebsiteBuilderController.saveDraft)
router.post('/pages/:id/publish', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.pageParamsSchema), WebsiteBuilderController.publishPage)
router.post('/pages/:id/schedule', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.pageParamsSchema), validateRequest(WebsiteBuilderValidation.scheduleSchema), WebsiteBuilderController.schedulePublish)
router.get('/pages/:id/revisions', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.pageParamsSchema), WebsiteBuilderController.listRevisions)
router.post('/pages/:id/revisions/:version/restore', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.revisionParamsSchema), WebsiteBuilderController.restoreRevision)
router.post('/pages/:id/preview-token', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.pageParamsSchema), WebsiteBuilderController.createPreviewToken)
router.get('/assets', authMiddlewares.requirePermission('website.write'), WebsiteBuilderController.listAssets)
router.post('/assets/presign', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.presignAssetSchema), WebsiteBuilderController.presignAsset)
router.post('/assets/import-url', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.importAssetUrlSchema), WebsiteBuilderController.importAssetUrl)
router.post('/assets/complete', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.completeAssetSchema), WebsiteBuilderController.completeAsset)
router.delete('/assets/:id', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.pageParamsSchema), WebsiteBuilderController.deleteAsset)
export const WebsiteBuilderRoute = router
