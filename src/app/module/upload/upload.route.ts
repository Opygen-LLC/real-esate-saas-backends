import express from 'express'
import { UploadController } from './upload.controller'
import { uploadSingle, uploadMultiple } from './upload.middleware'

const router = express.Router()

// POST /upload or /upload/single - Upload single image
router.post('/single', uploadSingle, UploadController.uploadSingle)
router.post('/', uploadSingle, UploadController.uploadSingle)

// POST /upload/multiple - Upload multiple images
router.post('/multiple', uploadMultiple, UploadController.uploadMultiple)

export const UploadRoute = router
