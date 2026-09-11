import type { NextFunction, Request, Response } from 'express'
import multer, { FileFilterCallback } from 'multer'
import path from 'path'
import ApiError from '../../../errors/ApiError'
import { API_ERROR_CODES } from '../../../contracts/apiContract'
import { MAX_DIRECT_UPLOAD_BYTES, MAX_DIRECT_UPLOAD_FILES, normalizeUploadFolder } from './upload.contract'

const storage = multer.memoryStorage()
const MAX_FILE_SIZE = MAX_DIRECT_UPLOAD_BYTES
const MAX_MULTIPLE_FILES = MAX_DIRECT_UPLOAD_FILES
const MAX_UPLOAD_FIELD_SIZE = 32

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
) => {
  const allowedMimeTypes = new Set(['image/jpeg', 'image/png'])
  const allowedExtensions = new Set(['.jpg', '.jpeg', '.png'])
  const originalName = String(file.originalname || '').replace(/\0/g, '').trim()
  const cleanName = path.posix.basename(path.win32.basename(originalName))
  const extension = path.extname(cleanName).toLowerCase()
  const mimeType = String(file.mimetype || '').toLowerCase()

  if (cleanName && cleanName.length <= 255 && allowedMimeTypes.has(mimeType) && allowedExtensions.has(extension)) {
    file.originalname = cleanName
    cb(null, true)
    return
  }

  cb(new ApiError(
    400,
    'Only JPEG, JPG, and PNG images are allowed.',
    '',
    'INVALID_UPLOAD_FILE_TYPE',
  ))
}

const singleUploader = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 1,
    parts: 10,
    fieldNameSize: 80,
    fieldSize: MAX_UPLOAD_FIELD_SIZE,
  },
  fileFilter,
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'image', maxCount: 1 },
  { name: 'avatar', maxCount: 1 },
  { name: 'logo', maxCount: 1 },
])

const multipleUploader = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_MULTIPLE_FILES,
    fields: 1,
    parts: MAX_MULTIPLE_FILES + 10,
    fieldNameSize: 80,
    fieldSize: MAX_UPLOAD_FIELD_SIZE,
  },
  fileFilter,
}).fields([
  { name: 'files', maxCount: MAX_MULTIPLE_FILES },
  { name: 'images', maxCount: MAX_MULTIPLE_FILES },
])

const multerErrorToApiError = (error: multer.MulterError): ApiError => {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return new ApiError(413, 'Image must be 5 MB or smaller.', '', API_ERROR_CODES.FILE_TOO_LARGE)
    case 'LIMIT_FILE_COUNT':
      return new ApiError(400, `You can upload up to ${MAX_MULTIPLE_FILES} images at a time.`, '', API_ERROR_CODES.TOO_MANY_FILES)
    case 'LIMIT_FIELD_COUNT':
      return new ApiError(400, "Only the 'folder' metadata field is allowed.", '', API_ERROR_CODES.TOO_MANY_FIELDS)
    case 'LIMIT_PART_COUNT':
      return new ApiError(400, 'The upload contains too many multipart parts.', '', API_ERROR_CODES.TOO_MANY_PARTS)
    case 'LIMIT_UNEXPECTED_FILE':
      return new ApiError(400, `Unexpected upload field '${String(error.field || '')}'.`, '', API_ERROR_CODES.INVALID_UPLOAD_FIELD)
    case 'LIMIT_FIELD_KEY':
    case 'LIMIT_FIELD_VALUE':
      return new ApiError(400, 'Upload metadata is invalid or too large.', '', API_ERROR_CODES.INVALID_UPLOAD_FIELD)
    default:
      return new ApiError(400, error.message || 'Invalid multipart upload.', '', API_ERROR_CODES.BAD_REQUEST)
  }
}

const validateUploadMetadata = (req: Request): void => {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
  const unexpectedFields = Object.keys(body).filter((key) => key !== 'folder')
  if (unexpectedFields.length) {
    throw new ApiError(
      400,
      `Unexpected upload metadata field '${unexpectedFields[0]}'.`,
      '',
      API_ERROR_CODES.INVALID_UPLOAD_FIELD,
      undefined,
      { [unexpectedFields[0]]: ['This upload metadata field is not allowed.'] },
    )
  }

  const folder = normalizeUploadFolder(body.folder)
  req.body = { ...body, folder }
}

type MulterRunner = (req: Request, res: Response, callback: (error?: any) => void) => void

const wrapUploader = (uploader: MulterRunner) => (req: Request, res: Response, next: NextFunction): void => {
  const startedAt = performance.now()
  res.locals.uploadStartedAtMs = startedAt

  uploader(req, res, (error?: any) => {
    res.locals.uploadReceiveMs = Math.round((performance.now() - startedAt) * 10) / 10

    if (error instanceof multer.MulterError) {
      next(multerErrorToApiError(error))
      return
    }
    if (error instanceof ApiError) {
      next(error)
      return
    }
    if (error) {
      next(new ApiError(400, error?.message || 'Invalid multipart upload.', '', API_ERROR_CODES.BAD_REQUEST))
      return
    }

    try {
      validateUploadMetadata(req)
      next()
    } catch (metadataError) {
      next(metadataError)
    }
  })
}

export const uploadSingle = wrapUploader(singleUploader)
export const uploadMultiple = wrapUploader(multipleUploader)
