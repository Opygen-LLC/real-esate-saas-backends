import { ObjectStorageService } from '../websiteBuilder/objectStorage.service'
import { randomBytes } from 'crypto'
import sharp from 'sharp'
import ApiError from '../../../errors/ApiError'
import httpStatus from 'http-status'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'
import { UsageBudgetService } from '../../security/usageBudget.service'
import { recordUploadSuccess } from '../../../shared/securityObservability'
import { logger } from '../../../shared/logger'
import { API_ERROR_CODES } from '../../../contracts/apiContract'
import { MAX_IMAGE_UPLOAD_PIXELS, assertImageDimensions, normalizeImageUploadMimeType } from '../../helpers/imageUploadPolicy'

export interface UploadPerformanceTelemetry {
  imageDecodeMs: number
  imageResizeMs: number
  imageEncodeMs: number
  storagePutMs: number
  originalBytes: number
  finalBytes: number
}

export interface IUploadResult {
  publicUrl: string
  sizeBytes: number
  telemetry?: UploadPerformanceTelemetry
}

// Max dimension: 1920px on longest side. Prevents 4K+ originals ballooning egress.
const MAX_DIMENSION = 1920
// Keep image work bounded so one 10-file request cannot start 10 CPU-heavy Sharp
// pipelines at once on a small Cloud Run instance.
const MAX_IMAGE_PROCESSING_CONCURRENCY = 2

const roundMs = (value: number): number => Math.round(value * 10) / 10

const sanitizeImage = async (
  buffer: Buffer,
  mimetype: string,
): Promise<{ buffer: Buffer; contentType: string; extension: string; decodeMs: number; resizeMs: number; encodeMs: number }> => {
  const normalizedType = normalizeImageUploadMimeType(mimetype)
  try {
    const probeStartedAt = performance.now()
    const metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: MAX_IMAGE_UPLOAD_PIXELS }).metadata()
    const decodeMs = roundMs(performance.now() - probeStartedAt)
    assertImageDimensions(metadata.width, metadata.height)

    // Produce a bounded raw image first. This makes resize and encode timings
    // independently observable while capping the intermediate buffer at about
    // 15 MB for a 1920x1920 RGBA image.
    const resizeStartedAt = performance.now()
    const resized = await sharp(buffer, { failOn: 'error', limitInputPixels: MAX_IMAGE_UPLOAD_PIXELS })
      .rotate()
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true })
    const resizeMs = roundMs(performance.now() - resizeStartedAt)

    const encoder = sharp(resized.data, {
      raw: {
        width: resized.info.width,
        height: resized.info.height,
        channels: resized.info.channels,
      },
    })
    const encodeStartedAt = performance.now()

    let output: Buffer
    let contentType: string
    let extension: string
    if (normalizedType === 'image/jpeg') {
      // libjpeg is materially faster than mozjpeg for synchronous request-path
      // uploads while keeping an appropriate web-image quality level.
      output = await encoder.jpeg({ quality: 82, mozjpeg: false }).toBuffer()
      contentType = 'image/jpeg'
      extension = 'jpg'
    } else if (normalizedType === 'image/png') {
      output = await encoder.png({ compressionLevel: 6 }).toBuffer()
      contentType = 'image/png'
      extension = 'png'
    } else if (normalizedType === 'image/webp') {
      output = await encoder.webp({ quality: 82 }).toBuffer()
      contentType = 'image/webp'
      extension = 'webp'
    } else if (normalizedType === 'image/avif') {
      output = await encoder.avif({ quality: 72 }).toBuffer()
      contentType = 'image/avif'
      extension = 'avif'
    } else {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Unsupported image format', '', API_ERROR_CODES.INVALID_IMAGE_TYPE)
    }

    return {
      buffer: output,
      contentType,
      extension,
      decodeMs,
      resizeMs,
      encodeMs: roundMs(performance.now() - encodeStartedAt),
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(httpStatus.BAD_REQUEST, 'The uploaded file is not a valid image.', '', API_ERROR_CODES.INVALID_IMAGE, undefined, { image: ['Choose a valid, decodable image.'] })
  }
}

const uploadFile = async (organizationId: string, file: Express.Multer.File): Promise<IUploadResult> => {
  await TenantPurgeBarrier.assertTenantWritable(organizationId)
  if (!file || !file.buffer) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No file buffer available for upload')
  }

  const sanitized = await sanitizeImage(file.buffer, file.mimetype)

  const tenantId = String(organizationId || '').trim()
  if (!tenantId) throw new ApiError(httpStatus.BAD_REQUEST, 'Organization id is required for uploads')
  const originalStem = (file.originalname || 'image').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'image'
  const objectKey = `tenants/${tenantId}/uploads/${Date.now()}-${randomBytes(4).toString('hex')}-${originalStem}.${sanitized.extension}`
  await UsageBudgetService.reserveUploadBytes(tenantId, sanitized.buffer.length)

  const storageStartedAt = performance.now()
  await ObjectStorageService.putBuffer(objectKey, sanitized.buffer, sanitized.contentType)
  const storagePutMs = roundMs(performance.now() - storageStartedAt)

  recordUploadSuccess({ kind: 'public-image', bytes: sanitized.buffer.length })
  logger.info('file_upload_completed', {
    event: 'file_upload_completed',
    kind: 'public-image',
    organizationId: tenantId,
    sizeBytes: sanitized.buffer.length,
  })

  return {
    publicUrl: ObjectStorageService.publicUrl(objectKey),
    sizeBytes: sanitized.buffer.length,
    telemetry: {
      imageDecodeMs: sanitized.decodeMs,
      imageResizeMs: sanitized.resizeMs,
      imageEncodeMs: sanitized.encodeMs,
      storagePutMs,
      originalBytes: Number(file.size || file.buffer.length || 0),
      finalBytes: sanitized.buffer.length,
    },
  }
}

const uploadMultipleFiles = async (organizationId: string, files: Express.Multer.File[]): Promise<IUploadResult[]> => {
  if (!files || files.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No files provided for upload')
  }

  const results = new Array<IUploadResult>(files.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < files.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await uploadFile(organizationId, files[index])
    }
  }
  const workerCount = Math.min(MAX_IMAGE_PROCESSING_CONCURRENCY, files.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

export const StorageService = {
  uploadFile,
  uploadMultipleFiles,
}
