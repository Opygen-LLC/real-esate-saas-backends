import type { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import ApiError from '../../../errors/ApiError'

const MAX_PROPERTY_IMAGE_BYTES = 20 * 1024 * 1024
const ALLOWED_PROPERTY_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif'])
const ALLOWED_PROPERTY_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif'])

const propertyImageUploader = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_PROPERTY_IMAGE_BYTES },
  fileFilter: (_req, file, callback) => {
    const mimeType = String(file.mimetype || '').toLowerCase()
    const extension = path.extname(String(file.originalname || '')).toLowerCase()
    if (!ALLOWED_PROPERTY_IMAGE_TYPES.has(mimeType) && !ALLOWED_PROPERTY_IMAGE_EXTENSIONS.has(extension)) {
      callback(new ApiError(400, 'Property photos must be JPEG, PNG, WebP, or AVIF images') as any)
      return
    }
    callback(null, true)
  },
}).single('image')

/**
 * Property-specific server upload fallback for browsers/networks that cannot PUT
 * to the presigned object-storage URL. It deliberately feeds the same draft
 * asset + malware-scan lifecycle as direct uploads; it is not the legacy
 * generic /upload endpoint.
 */
export const propertyImageUpload = (req: Request, res: Response, next: NextFunction) => {
  propertyImageUploader(req, res, (error: any) => {
    if (!error) return next()
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, 'Property photos must be 20 MB or smaller'))
      if (error.code === 'LIMIT_FILE_COUNT') return next(new ApiError(400, 'Upload one property photo at a time'))
      return next(new ApiError(400, error.message || 'Invalid property photo upload'))
    }
    if (error instanceof ApiError) return next(error)
    return next(new ApiError(400, error?.message || 'Invalid property photo upload'))
  })
}
