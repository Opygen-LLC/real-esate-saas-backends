import type { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import ApiError from '../../../errors/ApiError'
import { API_ERROR_CODES } from '../../../contracts/apiContract'
import { assertImageUploadFilename, assertImageUploadSize } from '../../helpers/imageUploadPolicy'

export const MAX_PROPERTY_FALLBACK_BYTES = 4 * 1024 * 1024


const propertyImageUploader = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_PROPERTY_FALLBACK_BYTES, fields: 5, parts: 10, fieldNameSize: 80, fieldSize: 1024 },
  fileFilter: (_req, file, callback) => {
    try {
      const normalized = assertImageUploadFilename(file.originalname, file.mimetype)
      file.originalname = normalized.filename
      file.mimetype = normalized.mimeType
      callback(null, true)
    } catch (error) {
      callback(error as any)
    }
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
    if (!error) {
      try {
        if (req.file) assertImageUploadSize(req.file.size, 'property')
        return next()
      } catch (validationError) {
        return next(validationError)
      }
    }
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, 'This property photo must use direct R2 upload because it is larger than the 4 MB server fallback limit.', '', API_ERROR_CODES.DIRECT_UPLOAD_REQUIRED, { maxFallbackBytes: MAX_PROPERTY_FALLBACK_BYTES }, { image: ['Files larger than 4 MB must upload directly to Cloudflare R2.'] }))
      if (error.code === 'LIMIT_FILE_COUNT') return next(new ApiError(400, 'Upload one property photo at a time'))
      return next(new ApiError(400, error.message || 'Invalid property photo upload'))
    }
    if (error instanceof ApiError) return next(error)
    return next(new ApiError(400, error?.message || 'Invalid property photo upload', '', API_ERROR_CODES.INVALID_IMAGE, undefined, { image: ['Choose a valid property image.'] }))
  })
}
