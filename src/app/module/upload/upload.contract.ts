import ApiError from '../../../errors/ApiError'
import { API_ERROR_CODES } from '../../../contracts/apiContract'
import { IMAGE_UPLOAD_MIME_TYPES, MAX_IMAGE_SOURCE_DIMENSION, MAX_IMAGE_UPLOAD_BYTES, MAX_IMAGE_UPLOAD_PIXELS, normalizeImageUploadMimeType } from '../../helpers/imageUploadPolicy'

export const MAX_DIRECT_UPLOAD_BYTES = MAX_IMAGE_UPLOAD_BYTES
export const MAX_DIRECT_UPLOAD_FILES = 10
export const DIRECT_UPLOAD_INTENT_TTL_MS = 60 * 60 * 1000
export const DIRECT_UPLOAD_COMPLETED_RETENTION_MS = 24 * 60 * 60 * 1000
export const DIRECT_UPLOAD_COMPLETION_LOCK_MS = 60 * 1000
export const DIRECT_UPLOAD_PROCESSING_LOCK_MS = 2 * 60 * 1000
export const DIRECT_UPLOAD_MAX_PIXELS = MAX_IMAGE_UPLOAD_PIXELS
export const DIRECT_UPLOAD_MAX_SOURCE_DIMENSION = MAX_IMAGE_SOURCE_DIMENSION

export const ALLOWED_UPLOAD_FOLDERS = ['general', 'avatar', 'branding', 'website', 'property'] as const
export type UploadFolder = (typeof ALLOWED_UPLOAD_FOLDERS)[number]

export const ALLOWED_UPLOAD_MIME_TYPES = IMAGE_UPLOAD_MIME_TYPES
export type UploadMimeType = (typeof ALLOWED_UPLOAD_MIME_TYPES)[number]

export type DirectUploadStatus = 'presigned' | 'uploaded' | 'verifying' | 'processing' | 'ready' | 'rejected'

const allowedFolders = new Set<string>(ALLOWED_UPLOAD_FOLDERS)

export const normalizeUploadFolder = (value: unknown): UploadFolder => {
  const folder = String(value || 'general').trim().toLowerCase()
  if (!allowedFolders.has(folder)) {
    throw new ApiError(
      400,
      `Invalid upload folder. Allowed values: ${ALLOWED_UPLOAD_FOLDERS.join(', ')}.`,
      '',
      API_ERROR_CODES.INVALID_UPLOAD_FOLDER,
      undefined,
      { folder: [`Choose one of: ${ALLOWED_UPLOAD_FOLDERS.join(', ')}.`] },
    )
  }
  return folder as UploadFolder
}

export const normalizeUploadMimeType = (value: unknown): UploadMimeType =>
  normalizeImageUploadMimeType(value) as UploadMimeType
