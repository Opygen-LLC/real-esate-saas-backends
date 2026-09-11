import ApiError from '../../../errors/ApiError'
import { API_ERROR_CODES } from '../../../contracts/apiContract'

export const MAX_DIRECT_UPLOAD_BYTES = 5 * 1024 * 1024
export const MAX_DIRECT_UPLOAD_FILES = 10
export const DIRECT_UPLOAD_INTENT_TTL_MS = 60 * 60 * 1000
export const DIRECT_UPLOAD_COMPLETED_RETENTION_MS = 24 * 60 * 60 * 1000
export const DIRECT_UPLOAD_COMPLETION_LOCK_MS = 60 * 1000

export const ALLOWED_UPLOAD_FOLDERS = ['general', 'avatar', 'branding', 'website', 'property'] as const
export type UploadFolder = (typeof ALLOWED_UPLOAD_FOLDERS)[number]

export const ALLOWED_UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png'] as const
export type UploadMimeType = (typeof ALLOWED_UPLOAD_MIME_TYPES)[number]

const allowedFolders = new Set<string>(ALLOWED_UPLOAD_FOLDERS)
const allowedMimeTypes = new Set<string>(ALLOWED_UPLOAD_MIME_TYPES)

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

export const normalizeUploadMimeType = (value: unknown): UploadMimeType => {
  const raw = String(value || '').trim().toLowerCase()
  const mimeType = raw === 'image/jpg' ? 'image/jpeg' : raw
  if (!allowedMimeTypes.has(mimeType)) {
    throw new ApiError(400, 'Only JPEG, JPG, and PNG images are allowed.', '', 'INVALID_UPLOAD_FILE_TYPE')
  }
  return mimeType as UploadMimeType
}
