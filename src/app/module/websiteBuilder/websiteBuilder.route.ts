import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import validateRequest from '../../middlewares/validateRequest'
import { WebsiteBuilderController } from './websiteBuilder.controller'
import { WebsiteBuilderValidation } from './websiteBuilder.validation'

const router = express.Router()
router.get('/templates', WebsiteBuilderController.getTemplates)
router.get('/components', WebsiteBuilderController.getComponents)
router.get('/public-site/:identifier/sitemap.xml', WebsiteBuilderController.sitemap)
router.get('/public-site/:identifier/robots.txt', WebsiteBuilderController.robots)
router.get('/public-site/:identifier/share-card/:propertyId', WebsiteBuilderController.propertyShareCard)
router.get('/public-site/:identifier/pages/:slug?', WebsiteBuilderController.getPublicPage)
router.get('/preview/:token', WebsiteBuilderController.getPreview)
router.get('/pages', authMiddlewares.requirePermission('website.write'), WebsiteBuilderController.getAllPages)
router.get('/pages/:id', authMiddlewares.requirePermission('website.write'), WebsiteBuilderController.getPageById)
router.put('/pages/:id/draft', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.saveDraftSchema), WebsiteBuilderController.saveDraft)
router.post('/pages/:id/publish', authMiddlewares.requirePermission('website.write'), WebsiteBuilderController.publishPage)
router.post('/pages/:id/schedule', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.scheduleSchema), WebsiteBuilderController.schedulePublish)
router.get('/pages/:id/revisions', authMiddlewares.requirePermission('website.write'), WebsiteBuilderController.listRevisions)
router.post('/pages/:id/revisions/:version/restore', authMiddlewares.requirePermission('website.write'), WebsiteBuilderController.restoreRevision)
router.post('/pages/:id/preview-token', authMiddlewares.requirePermission('website.write'), WebsiteBuilderController.createPreviewToken)
router.get('/assets', authMiddlewares.requirePermission('website.write'), WebsiteBuilderController.listAssets)
router.post('/assets/presign', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.presignAssetSchema), WebsiteBuilderController.presignAsset)
router.post('/assets/import-url', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.importAssetUrlSchema), WebsiteBuilderController.importAssetUrl)
router.post('/assets/complete', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.completeAssetSchema), WebsiteBuilderController.completeAsset)
router.delete('/assets/:id', authMiddlewares.requirePermission('website.write'), WebsiteBuilderController.deleteAsset)
export const WebsiteBuilderRoute = router
