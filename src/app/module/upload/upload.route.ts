import express from 'express'
import { UploadController } from './upload.controller'
import { uploadSingle, uploadMultiple } from './upload.middleware'
import { authMiddlewares } from '../../middlewares/auth'
import { validateUploadedFiles } from '../../middlewares/requestInputGuard'
import { uploadPresignRateLimiter, uploadRateLimiter } from '../../middlewares/rateLimiter'

const router = express.Router()

// Primary Phase 3 flow: the API authorizes the upload, but image bytes travel
// directly from the browser to Cloudflare R2 using the signed PUT URL.
router.post('/presign', authMiddlewares.auth(), uploadPresignRateLimiter, UploadController.presignDirectUpload)
router.post('/complete', authMiddlewares.auth(), uploadRateLimiter, UploadController.completeDirectUpload)
router.get('/status/:uploadId', authMiddlewares.auth(), uploadPresignRateLimiter, UploadController.directUploadStatus)

// POST /upload or /upload/single - Upload single image
router.post('/single', authMiddlewares.auth(), uploadRateLimiter, uploadSingle, validateUploadedFiles, UploadController.uploadSingle)
router.post('/', authMiddlewares.auth(), uploadRateLimiter, uploadSingle, validateUploadedFiles, UploadController.uploadSingle)

// POST /upload/multiple - Upload multiple images
router.post('/multiple', authMiddlewares.auth(), uploadRateLimiter, uploadMultiple, validateUploadedFiles, UploadController.uploadMultiple)

export const UploadRoute = router
