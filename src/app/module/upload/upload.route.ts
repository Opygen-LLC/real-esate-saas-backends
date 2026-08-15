import express from 'express'
import { UploadController } from './upload.controller'
import { uploadSingle, uploadMultiple } from './upload.middleware'

const router = express.Router()

// POST /upload or /upload/single - Upload single file
router.post('/single', uploadSingle, UploadController.uploadSingle)
router.post('/', uploadSingle, UploadController.uploadSingle)

// POST /upload/multiple - Upload multiple files
router.post('/multiple', uploadMultiple, UploadController.uploadMultiple)

// GET /upload/signed-url/:fileName - Get temporary signed URL
router.get('/signed-url/:fileName', UploadController.getSignedUrl)
router.get('/signed-url', UploadController.getSignedUrl)

// DELETE /upload/:fileName - Delete file from GCS
router.delete('/:fileName', UploadController.deleteFile)
router.delete('/', UploadController.deleteFile)

export const UploadRoute = router
