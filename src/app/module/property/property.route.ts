import express from 'express'
import { authMiddlewares } from '../../middlewares/auth'
import { propertyImportRateLimiter, uploadRateLimiter } from '../../middlewares/rateLimiter'
import validateRequest from '../../middlewares/validateRequest'
import { PropertyController } from './property.controller'
import { PropertyValidation } from './property.validation'
import { propertyImportUpload } from './propertyImport.middleware'
import { propertyImageUpload } from './propertyMedia.middleware'

const router = express.Router()

// Public endpoints (no authentication required)
router.get('/public-detail/:id', PropertyController.getPublicPropertyDetail)
router.get('/public/:organizationId', PropertyController.getPublicProperties)
router.get('/public/:organizationId/slug/:slug', PropertyController.getPublicPropertyBySlug)

// Authenticated import/export. Import is always preview -> confirm; there is no
// direct spreadsheet-to-database route.
router.get('/import/template.csv', authMiddlewares.requirePermission('properties.write'), PropertyController.downloadImportCsvTemplate)
router.get('/import/template.xlsx', authMiddlewares.requirePermission('properties.write'), PropertyController.downloadImportXlsxTemplate)
router.post('/import/preview', authMiddlewares.requirePermission('properties.write'), propertyImportRateLimiter, propertyImportUpload, PropertyController.previewImport)
router.post('/import/confirm', authMiddlewares.requirePermission('properties.write'), propertyImportRateLimiter, validateRequest(PropertyValidation.confirmImportZodSchema), PropertyController.confirmImport)
router.get('/export/csv', authMiddlewares.requirePermission('properties.read'), PropertyController.exportCsv)
router.get('/export/xlsx', authMiddlewares.requirePermission('properties.read'), PropertyController.exportXlsx)

// Private property documents use signed object-storage URLs and are never exposed through public property DTOs.
router.post('/documents/presign', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.presignDocumentZodSchema), PropertyController.presignPropertyDocument)
router.post('/documents/:assetId/complete', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.completeDocumentZodSchema), PropertyController.completePropertyDocument)
router.get('/documents/:assetId/download', authMiddlewares.requirePermission('properties.read'), validateRequest(PropertyValidation.documentAssetZodSchema), PropertyController.downloadPropertyDocument)
router.delete('/documents/session/:sessionId/:assetId', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.deleteDraftDocumentZodSchema), PropertyController.deletePropertyDraftDocument)

// Property media uses property permissions while reusing the hardened storage pipeline.
router.post('/assets/presign', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.presignImageZodSchema), PropertyController.presignPropertyImage)
router.post('/assets/upload', authMiddlewares.requirePermission('properties.write'), uploadRateLimiter, propertyImageUpload, PropertyController.uploadPropertyImage)
router.post('/assets/complete', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.completeImageZodSchema), PropertyController.completePropertyImage)
router.post('/assets/import-url', authMiddlewares.requirePermission('properties.write'), uploadRateLimiter, validateRequest(PropertyValidation.importImageUrlZodSchema), PropertyController.importPropertyImageUrl)
router.get('/assets/session/:sessionId', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.draftSessionZodSchema), PropertyController.getPropertyDraftSession)
router.post('/assets/session/:sessionId/touch', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.draftSessionZodSchema), PropertyController.touchPropertyDraftSession)
router.delete('/assets/session/:sessionId/:assetId', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.deleteDraftAssetZodSchema), PropertyController.deletePropertyDraftAsset)
router.delete('/assets/session/:sessionId', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.cleanupDraftSessionZodSchema), PropertyController.cleanupPropertyDraftSession)
router.get('/assets/:assetId', authMiddlewares.requirePermission('properties.write'), PropertyController.getPropertyImageAsset)

router.get('/', authMiddlewares.requirePermission('properties.read'), PropertyController.getAllProperties)
router.post('/', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.createPropertyZodSchema), PropertyController.createProperty)
router.get('/:id', authMiddlewares.requirePermission('properties.read'), PropertyController.getPropertyById)
router.patch('/:id', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.updatePropertyZodSchema), PropertyController.updateProperty)
router.patch('/:id/status', authMiddlewares.requirePermission('properties.publish'), validateRequest(PropertyValidation.updateStatusZodSchema), PropertyController.updatePropertyStatus)
router.patch('/:id/quota-access', authMiddlewares.requirePermission('properties.publish'), validateRequest(PropertyValidation.updateQuotaAccessZodSchema), PropertyController.updatePropertyQuotaAccess)
router.patch('/:id/images/reorder', authMiddlewares.requirePermission('properties.write'), validateRequest(PropertyValidation.reorderImagesZodSchema), PropertyController.reorderPropertyImages)
router.delete('/:id', authMiddlewares.requirePermission('properties.delete'), PropertyController.deleteProperty)

export const PropertyRoute = router
