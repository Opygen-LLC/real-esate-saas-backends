import express from 'express'
import { UploadController } from './upload.controller'
import { uploadSingle, uploadMultiple } from './upload.middleware'
import { authMiddlewares } from '../../middlewares/auth'
import { validateUploadedFiles } from '../../middlewares/requestInputGuard'

const router = express.Router()

// POST /upload or /upload/single - Upload single image
router.post('/single', authMiddlewares.auth(), uploadSingle, validateUploadedFiles, UploadController.uploadSingle)
router.post('/', authMiddlewares.auth(), uploadSingle, validateUploadedFiles, UploadController.uploadSingle)

// POST /upload/multiple - Upload multiple images
router.post('/multiple', authMiddlewares.auth(), uploadMultiple, validateUploadedFiles, UploadController.uploadMultiple)

export const UploadRoute = router
