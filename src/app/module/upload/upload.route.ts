import express from 'express'
import { UploadController } from './upload.controller'
import { uploadSingle, uploadMultiple } from './upload.middleware'
import { authMiddlewares } from '../../middlewares/auth'

const router = express.Router()

// POST /upload or /upload/single - Upload single image
router.post('/single', authMiddlewares.auth(), uploadSingle, UploadController.uploadSingle)
router.post('/', authMiddlewares.auth(), uploadSingle, UploadController.uploadSingle)

// POST /upload/multiple - Upload multiple images
router.post('/multiple', authMiddlewares.auth(), uploadMultiple, UploadController.uploadMultiple)

export const UploadRoute = router
