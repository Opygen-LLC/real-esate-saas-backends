import sharp, { type Metadata } from 'sharp'
import ApiError from '../../../errors/ApiError'
import { ObjectStorageService } from './objectStorage.service'
import { API_ERROR_CODES } from '../../../contracts/apiContract'
import {
  MAX_IMAGE_UPLOAD_PIXELS,
  assertImageDimensions,
  assertImageUploadFilename,
  type ImageUploadContext,
} from '../../helpers/imageUploadPolicy'

const IMAGE_FORMAT_BY_MIME: Record<string, string[]> = {
  'image/jpeg': ['jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/avif': ['avif', 'heif'],
}

const EXTENSIONS_BY_MIME: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/avif': ['.avif'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'font/woff2': ['.woff2'],
}

const MAX_IMAGE_PIXELS = MAX_IMAGE_UPLOAD_PIXELS
const MAX_LEGACY_STORED_DIMENSION = 4_096
export const CANONICAL_PUBLIC_IMAGE_MIME = 'image/webp' as const
export const CANONICAL_PUBLIC_IMAGE_EXTENSION = 'webp' as const

export const PUBLIC_IMAGE_OPTIMIZATION_PROFILES: Record<ImageUploadContext, { maxDimension: number; quality: number; effort: number }> = {
  property: { maxDimension: 1_920, quality: 80, effort: 4 },
  website: { maxDimension: 1_920, quality: 80, effort: 4 },
  avatar: { maxDimension: 512, quality: 80, effort: 4 },
  branding: { maxDimension: 1_200, quality: 82, effort: 4 },
  general: { maxDimension: 1_920, quality: 80, effort: 4 },
}

const assertSafeUploadFilename = (originalName: string, expectedMime: string): void => {
  if (expectedMime in IMAGE_FORMAT_BY_MIME) {
    assertImageUploadFilename(originalName, expectedMime)
    return
  }
  const name = String(originalName || '').trim()
  if (!name || name.length > 255 || /[\/\\\u0000]/.test(name) || name === '.' || name === '..') {
    throw new ApiError(400, 'Invalid upload filename')
  }
  const lower = name.toLowerCase()
  const allowed = EXTENSIONS_BY_MIME[expectedMime]
  if (!allowed || !allowed.some((extension) => lower.endsWith(extension))) {
    throw new ApiError(400, 'Upload filename extension does not match the declared file type')
  }
}

const validateImageMetadata = (metadata: Metadata, expectedMime: string): Metadata => {
  if (!metadata.format || !IMAGE_FORMAT_BY_MIME[expectedMime]?.includes(metadata.format)) {
    throw new ApiError(400, 'Uploaded image bytes do not match the declared file type.', '', API_ERROR_CODES.INVALID_IMAGE_TYPE, undefined, {
      image: ['The uploaded bytes must match the declared image type.'],
    })
  }
  const width = Number(metadata.width || 0)
  const height = Number(metadata.height || 0)
  assertImageDimensions(width, height)
  if (Number(metadata.pages || 1) > 1) {
    throw new ApiError(400, 'Animated or multi-page images are not allowed', '', API_ERROR_CODES.INVALID_IMAGE_BYTES)
  }
  return metadata
}

const validateImage = async (body: Buffer, expectedMime: string) => {
  try {
    const metadata = await sharp(body, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS }).metadata()
    return validateImageMetadata(metadata, expectedMime)
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(
      400,
      'Uploaded file is not a valid image.',
      '',
      API_ERROR_CODES.INVALID_IMAGE_BYTES,
      undefined,
      { image: ['Choose a valid, decodable image.'] },
    )
  }
}

const validateSignature = async (body: Buffer, expectedMime: string): Promise<void> => {
  if (expectedMime in IMAGE_FORMAT_BY_MIME) {
    await validateImage(body, expectedMime)
    return
  }
  if (expectedMime === 'application/pdf') {
    if (body.length < 8 || body.subarray(0, 5).toString('ascii') !== '%PDF-') throw new ApiError(400, 'Uploaded file is not a valid PDF')
    const tail = body.subarray(Math.max(0, body.length - 8192)).toString('latin1')
    const eofIndex = tail.lastIndexOf('%%EOF')
    if (eofIndex < 0 || tail.slice(eofIndex + 5).trim().length > 0) throw new ApiError(400, 'PDF contains trailing or polyglot data')
    const sample = body.toString('latin1').toLowerCase()
    if (/\/(javascript|js|launch|embeddedfile)\b/.test(sample)) throw new ApiError(400, 'Active or embedded PDF content is not allowed')
    return
  }
  if (expectedMime === 'font/woff2') {
    if (body.length < 4 || body.subarray(0, 4).toString('ascii') !== 'wOF2') throw new ApiError(400, 'Uploaded file is not a valid WOFF2 font')
    return
  }
  if (expectedMime === 'text/plain') {
    if (body.includes(0)) throw new ApiError(400, 'Text attachments may not contain binary data')
    return
  }
  throw new ApiError(400, 'Uploaded file type is not allowed')
}

const validateStoredFile = async (key: string, expectedMime: string, maxBytes: number) => {
  const body = await ObjectStorageService.readBuffer(key, maxBytes)
  await validateSignature(body, expectedMime)
  return { body, size: body.length }
}

const inspectStoredImage = async (key: string, expectedMime: string, maxBytes: number) => {
  if (!(expectedMime in IMAGE_FORMAT_BY_MIME)) throw new ApiError(400, 'Stored object is not a supported image type')
  const body = await ObjectStorageService.readBuffer(key, maxBytes)
  const metadata = await validateImage(body, expectedMime)
  return { body, size: body.length, metadata }
}

/**
 * Legacy same-format sanitizer retained for rolling-deploy compatibility with
 * browser-created Phase 3 variants. New public images use
 * prepareCanonicalPublicImage() below and are always stored as WebP.
 */
const sanitizeImageBuffer = async (
  body: Buffer,
  expectedMime: string,
  options: { maxWidth?: number; maxHeight?: number } = {},
) => {
  try {
    await validateImage(body, expectedMime)
    const maxWidth = Math.max(1, Math.min(MAX_LEGACY_STORED_DIMENSION, Math.floor(options.maxWidth || MAX_LEGACY_STORED_DIMENSION)))
    const maxHeight = Math.max(1, Math.min(MAX_LEGACY_STORED_DIMENSION, Math.floor(options.maxHeight || MAX_LEGACY_STORED_DIMENSION)))
    const pipeline = sharp(body, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })

    let sanitized: Buffer
    if (expectedMime === 'image/jpeg') sanitized = await pipeline.jpeg({ quality: 86, mozjpeg: false }).toBuffer()
    else if (expectedMime === 'image/png') sanitized = await pipeline.png({ compressionLevel: 6 }).toBuffer()
    else if (expectedMime === 'image/webp') sanitized = await pipeline.webp({ quality: 84, effort: 4 }).toBuffer()
    else if (expectedMime === 'image/avif') sanitized = await pipeline.avif({ quality: 72 }).toBuffer()
    else throw new ApiError(400, 'Unsupported public image format.', '', API_ERROR_CODES.INVALID_IMAGE_TYPE, undefined, { image: ['Choose a supported image type.'] })

    const metadata = validateImageMetadata(
      await sharp(sanitized, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS }).metadata(),
      expectedMime,
    )
    return { buffer: sanitized, size: sanitized.length, width: Number(metadata.width), height: Number(metadata.height) }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(422, 'Uploaded image could not be safely normalized.', '', API_ERROR_CODES.IMAGE_PROCESSING_FAILED, undefined, { image: ['Choose another valid image.'] })
  }
}

/**
 * Canonical public-image normalization. The uploaded source remains in the
 * private R2 staging namespace while this runs. The output contains no copied
 * EXIF/profile metadata, is bounded by a context-specific dimension, and is
 * always WebP so durable storage is small before Cloudflare edge transforms.
 */
const canonicalizeImageBuffer = async (
  body: Buffer,
  expectedMime: string,
  context: ImageUploadContext,
) => {
  try {
    await validateImage(body, expectedMime)
    const profile = PUBLIC_IMAGE_OPTIMIZATION_PROFILES[context] || PUBLIC_IMAGE_OPTIMIZATION_PROFILES.general
    const buffer = await sharp(body, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize({
        width: profile.maxDimension,
        height: profile.maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({
        quality: profile.quality,
        effort: profile.effort,
        alphaQuality: 90,
        smartSubsample: true,
      })
      .toBuffer()

    const metadata = validateImageMetadata(
      await sharp(buffer, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS }).metadata(),
      CANONICAL_PUBLIC_IMAGE_MIME,
    )
    return {
      buffer,
      size: buffer.length,
      width: Number(metadata.width),
      height: Number(metadata.height),
      mimeType: CANONICAL_PUBLIC_IMAGE_MIME,
      extension: CANONICAL_PUBLIC_IMAGE_EXTENSION,
      profile,
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(
      422,
      'We could not safely process this image. Please choose another photo.',
      '',
      API_ERROR_CODES.IMAGE_PROCESSING_FAILED,
      undefined,
      { image: ['The image could not be converted into a safe optimized WebP.'] },
    )
  }
}

const canonicalPublicImageKey = (value: string): string => {
  const key = String(value || '').trim()
  if (!key) throw new ApiError(400, 'A public image key is required')
  const slash = key.lastIndexOf('/')
  const dot = key.lastIndexOf('.')
  const stem = dot > slash ? key.slice(0, dot) : key
  return `${stem}.${CANONICAL_PUBLIC_IMAGE_EXTENSION}`
}

const prepareCanonicalPublicImage = async (
  key: string,
  expectedMime: string,
  context: ImageUploadContext,
  options: { maxBytes?: number } = {},
) => {
  const maxBytes = options.maxBytes || 25 * 1024 * 1024
  const { body } = await inspectStoredImage(key, expectedMime, maxBytes)
  return canonicalizeImageBuffer(body, expectedMime, context)
}

/** Backward-compatible same-format helper for legacy callers. */
const prepareStoredPublicImage = async (
  key: string,
  expectedMime: string,
  options: { maxWidth?: number; maxHeight?: number; maxBytes?: number } = {},
) => {
  const maxBytes = options.maxBytes || 25 * 1024 * 1024
  const { body } = await inspectStoredImage(key, expectedMime, maxBytes)
  return sanitizeImageBuffer(body, expectedMime, options)
}

/** Backward-compatible in-place sanitizer for older variant callers. */
const sanitizeStoredPublicImage = async (
  key: string,
  expectedMime: string,
  options: { maxWidth?: number; maxHeight?: number; maxBytes?: number } = {},
) => {
  const sanitized = await prepareStoredPublicImage(key, expectedMime, options)
  await ObjectStorageService.putBuffer(key, sanitized.buffer, expectedMime)
  return { size: sanitized.size, width: sanitized.width, height: sanitized.height }
}

export const StoredFileSecurityService = {
  assertSafeUploadFilename,
  validateStoredFile,
  inspectStoredImage,
  sanitizeImageBuffer,
  canonicalizeImageBuffer,
  canonicalPublicImageKey,
  prepareCanonicalPublicImage,
  prepareStoredPublicImage,
  sanitizeStoredPublicImage,
}
