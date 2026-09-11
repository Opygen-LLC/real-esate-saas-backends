import path from 'path'
import { API_ERROR_CODES } from '../../contracts/apiContract'
import ApiError from '../../errors/ApiError'

export type ImageUploadContext = 'property' | 'website' | 'avatar' | 'branding' | 'general'
export type ImageUploadMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'

export const IMAGE_UPLOAD_POLICY = {
  property: { maxBytes: 5 * 1024 * 1024, maxPixels: 40_000_000, maxDimension: 12_000, label: 'Property photos' },
  website: { maxBytes: 5 * 1024 * 1024, maxPixels: 40_000_000, maxDimension: 12_000, label: 'Website images' },
  avatar: { maxBytes: 5 * 1024 * 1024, maxPixels: 40_000_000, maxDimension: 12_000, label: 'Profile images' },
  branding: { maxBytes: 5 * 1024 * 1024, maxPixels: 40_000_000, maxDimension: 12_000, label: 'Branding images' },
  general: { maxBytes: 5 * 1024 * 1024, maxPixels: 40_000_000, maxDimension: 12_000, label: 'Images' },
} as const

export const IMAGE_UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const
export const MAX_IMAGE_UPLOAD_BYTES = Math.max(...Object.values(IMAGE_UPLOAD_POLICY).map((policy) => policy.maxBytes))
export const MAX_IMAGE_UPLOAD_PIXELS = 40_000_000
export const MAX_IMAGE_SOURCE_DIMENSION = 12_000

const extensionByMime: Record<ImageUploadMimeType, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/avif': ['.avif'],
}

export const normalizeImageUploadMimeType = (value: unknown): ImageUploadMimeType => {
  const raw = String(value || '').trim().toLowerCase()
  const mimeType = raw === 'image/jpg' ? 'image/jpeg' : raw
  if (!IMAGE_UPLOAD_MIME_TYPES.includes(mimeType as ImageUploadMimeType)) {
    throw new ApiError(400, 'Use a JPG, JPEG, PNG, WebP or AVIF image.', '', API_ERROR_CODES.INVALID_IMAGE_TYPE, undefined, {
      image: ['Supported image types are JPG, JPEG, PNG, WebP and AVIF.'],
    })
  }
  return mimeType as ImageUploadMimeType
}

export const imageUploadPolicyFor = (context: ImageUploadContext) => IMAGE_UPLOAD_POLICY[context]

export const assertImageUploadSize = (sizeValue: unknown, context: ImageUploadContext, field = 'image'): number => {
  const size = Number(sizeValue)
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new ApiError(400, 'The selected image is empty.', '', API_ERROR_CODES.EMPTY_IMAGE, undefined, {
      [field]: ['Choose a non-empty image.'],
    })
  }
  const policy = imageUploadPolicyFor(context)
  if (size > policy.maxBytes) {
    const maxMb = policy.maxBytes / (1024 * 1024)
    throw new ApiError(413, `${policy.label} must be ${maxMb} MB or smaller.`, '', API_ERROR_CODES.IMAGE_TOO_LARGE, undefined, {
      [field]: [`Maximum file size is ${maxMb} MB.`],
    })
  }
  return size
}

export const assertImageUploadFilename = (filenameValue: unknown, mimeValue: unknown, field = 'image'): { filename: string; mimeType: ImageUploadMimeType } => {
  const filename = String(filenameValue || '').replace(/\0/g, '').trim()
  const cleanName = path.posix.basename(path.win32.basename(filename))
  if (!cleanName || cleanName.length > 255 || cleanName === '.' || cleanName === '..') {
    throw new ApiError(400, 'Invalid image filename.', '', API_ERROR_CODES.INVALID_IMAGE, undefined, {
      [field]: ['Choose an image with a valid filename.'],
    })
  }
  const mimeType = normalizeImageUploadMimeType(mimeValue)
  const extension = path.extname(cleanName).toLowerCase()
  if (!extensionByMime[mimeType].includes(extension)) {
    throw new ApiError(400, 'The image extension does not match its file type.', '', API_ERROR_CODES.INVALID_IMAGE_TYPE, undefined, {
      [field]: ['The filename extension must match the declared image type.'],
    })
  }
  return { filename: cleanName, mimeType }
}

export const assertImageDimensions = (widthValue: unknown, heightValue: unknown, field = 'image') => {
  const width = Number(widthValue)
  const height = Number(heightValue)
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new ApiError(400, 'Uploaded image has invalid dimensions.', '', API_ERROR_CODES.INVALID_IMAGE, undefined, {
      [field]: ['The image could not be decoded with valid dimensions.'],
    })
  }
  if (width > MAX_IMAGE_SOURCE_DIMENSION || height > MAX_IMAGE_SOURCE_DIMENSION) {
    throw new ApiError(413, `Maximum image dimension is ${MAX_IMAGE_SOURCE_DIMENSION.toLocaleString()} px.`, '', API_ERROR_CODES.IMAGE_DIMENSIONS_TOO_LARGE, undefined, {
      [field]: [`Width and height must each be ${MAX_IMAGE_SOURCE_DIMENSION.toLocaleString()} px or smaller.`],
    })
  }
  if (width * height > MAX_IMAGE_UPLOAD_PIXELS) {
    throw new ApiError(413, 'Maximum supported image resolution is 40 megapixels.', '', API_ERROR_CODES.IMAGE_PIXEL_LIMIT_EXCEEDED, undefined, {
      [field]: ['Choose an image with 40 megapixels or fewer.'],
    })
  }
  return { width, height }
}
