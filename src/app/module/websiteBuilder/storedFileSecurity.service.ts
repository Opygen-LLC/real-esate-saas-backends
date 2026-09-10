import sharp from 'sharp'
import ApiError from '../../../errors/ApiError'
import { ObjectStorageService } from './objectStorage.service'

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

const assertSafeUploadFilename = (originalName: string, expectedMime: string): void => {
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

const validateImage = async (body: Buffer, expectedMime: string) => {
  try {
    const metadata = await sharp(body, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata()
    if (!metadata.format || !IMAGE_FORMAT_BY_MIME[expectedMime]?.includes(metadata.format)) {
      throw new ApiError(400, 'Uploaded image bytes do not match the declared file type')
    }
    return metadata
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'Uploaded file is not a valid image')
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

/**
 * Re-encode public images after scanning. Decoding + re-encoding removes EXIF,
 * embedded profiles and trailing/polyglot bytes while bounding dimensions.
 */
const sanitizeStoredPublicImage = async (
  key: string,
  expectedMime: string,
  options: { maxWidth?: number; maxHeight?: number; maxBytes?: number } = {},
) => {
  const maxBytes = options.maxBytes || 25 * 1024 * 1024
  const { body } = await validateStoredFile(key, expectedMime, maxBytes)
  try {
    let pipeline = sharp(body, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate()
    const maxWidth = Math.max(1, Math.min(4096, Math.floor(options.maxWidth || 4096)))
    const maxHeight = Math.max(1, Math.min(4096, Math.floor(options.maxHeight || 4096)))
    pipeline = pipeline.resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })

    let sanitized: Buffer
    if (expectedMime === 'image/jpeg') sanitized = await pipeline.jpeg({ quality: 84, mozjpeg: true }).toBuffer()
    else if (expectedMime === 'image/png') sanitized = await pipeline.png({ compressionLevel: 8 }).toBuffer()
    else if (expectedMime === 'image/webp') sanitized = await pipeline.webp({ quality: 84 }).toBuffer()
    else if (expectedMime === 'image/avif') sanitized = await pipeline.avif({ quality: 72 }).toBuffer()
    else throw new ApiError(400, 'Unsupported public image format')

    const metadata = await sharp(sanitized, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata()
    await ObjectStorageService.putBuffer(key, sanitized, expectedMime)
    return { size: sanitized.length, width: metadata.width, height: metadata.height }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'Uploaded image could not be safely normalized')
  }
}

export const StoredFileSecurityService = { assertSafeUploadFilename, validateStoredFile, sanitizeStoredPublicImage }
