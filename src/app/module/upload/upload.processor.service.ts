import mongoose from 'mongoose'
import config from '../../../config'
import { API_ERROR_CODES } from '../../../contracts/apiContract'
import ApiError from '../../../errors/ApiError'
import { logger } from '../../../shared/logger'
import { recordUploadSuccess } from '../../../shared/securityObservability'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import type { ImageUploadContext } from '../../helpers/imageUploadPolicy'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Organization } from '../organization/organization.model'
import { ObjectStorageService } from '../websiteBuilder/objectStorage.service'
import { StoredFileSecurityService } from '../websiteBuilder/storedFileSecurity.service'
import { scanStoredObject } from '../websiteBuilder/virusScan.service'
import {
  DIRECT_UPLOAD_PROCESSING_LOCK_MS,
  MAX_DIRECT_UPLOAD_BYTES,
} from './upload.contract'
import { UploadIntent } from './uploadIntent.model'

const MAX_PROCESSING_ATTEMPTS = 5
const PROCESSING_MIME = 'image/webp'

const safeErrorMessage = (error: any): string => String(error?.message || 'image_processing_failed').slice(0, 240)
const isSecurityRejection = (error: any): boolean => {
  const status = Number(error?.statusCode || error?.status || 0)
  return status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429
}

const processingKeyForIntent = (intent: any): string =>
  `tenants/${String(intent.organizationId)}/upload-staging/processed/${String(intent.uploadId)}.webp`

const imageContextForIntent = (intent: any): ImageUploadContext => {
  const value = String(intent.folder || 'general')
  return ['property', 'website', 'avatar', 'branding', 'general'].includes(value)
    ? value as ImageUploadContext
    : 'general'
}

const mappedProcessingError = (error: any): any => {
  const status = Number(error?.statusCode || error?.status || 0)
  if (status === 422 && !error?.errorCode && !error?.code) {
    return new ApiError(
      422,
      'We could not safely process this image. Please choose another photo.',
      '',
      API_ERROR_CODES.IMAGE_MALWARE_REJECTED,
    )
  }
  return error
}

const rejectIntent = async (intent: any, rawError: any) => {
  const error = mappedProcessingError(rawError)
  const code = String(error?.errorCode || error?.code || API_ERROR_CODES.IMAGE_PROCESSING_FAILED).slice(0, 80)
  const message = safeErrorMessage(error)
  const canonicalKey = StoredFileSecurityService.canonicalPublicImageKey(String(intent.key || ''))
  await UploadIntent.updateOne(
    { _id: intent._id, status: { $in: ['verifying', 'processing', 'uploaded'] } },
    { $set: { status: 'rejected', failureCode: code, failureMessage: message, lastProcessingError: message, completedAt: new Date() } },
  )
  const keys = Array.from(new Set([
    String(intent.uploadKey || ''),
    String(intent.key || ''),
    canonicalKey,
    processingKeyForIntent(intent),
  ].filter(Boolean)))
  await Promise.allSettled(keys.map((key) => ObjectStorageService.remove(key)))
  logger.warn('direct_image_processing_rejected', { organizationId: intent.organizationId, uploadId: intent.uploadId, code })
}

const scheduleRetry = async (intent: any, error: any) => {
  const attempts = Number(intent.processingAttempts || 1)
  await ObjectStorageService.remove(processingKeyForIntent(intent)).catch(() => undefined)
  if (attempts >= MAX_PROCESSING_ATTEMPTS) {
    await rejectIntent(intent, new ApiError(
      422,
      'We could not safely process this image after multiple attempts. Please choose another photo.',
      '',
      API_ERROR_CODES.IMAGE_PROCESSING_FAILED,
    ))
    return
  }
  const delayMs = Math.min(60_000, 1_000 * (2 ** Math.max(0, attempts - 1)))
  await UploadIntent.updateOne(
    { _id: intent._id, status: { $in: ['verifying', 'processing'] } },
    { $set: { status: 'uploaded', processingStartedAt: null, nextProcessingAt: new Date(Date.now() + delayMs), lastProcessingError: safeErrorMessage(error) } },
  )
  logger.warn('direct_image_processing_retry_scheduled', {
    organizationId: intent.organizationId,
    uploadId: intent.uploadId,
    attempts,
    delayMs,
    error: safeErrorMessage(error),
  })
}

const finalizeAccounting = async (
  intent: any,
  finalKey: string,
  finalObject: any,
  normalized: { width: number; height: number; size: number; mimeType: string },
) => {
  const supportsTransactions = await mongoSupportsTransactions()
  if (config.isProduction && !supportsTransactions) throw new ApiError(503, 'Image processing requires transaction-capable MongoDB.', '', 'IMAGE_PROCESSING_UNAVAILABLE')
  const publicUrl = ObjectStorageService.publicImageUrl(finalKey)
  const processedAt = new Date()

  const persist = async (session: mongoose.ClientSession | null) => {
    const query = UploadIntent.findOne({ _id: intent._id, organizationId: intent.organizationId, status: 'processing' })
    if (session) query.session(session)
    const current: any = await query
    if (!current) return false
    const previousSize = Number(current.finalSize || 0)
    const delta = Number(normalized.size) - previousSize
    if (delta) {
      await Organization.updateOne(
        { organizationId: intent.organizationId },
        { $inc: { storageUsedBytes: delta } },
        session ? { session } : undefined,
      )
    }
    await UploadIntent.updateOne(
      { _id: current._id, status: 'processing' },
      { $set: {
        status: 'ready',
        key: finalKey,
        finalSize: Number(normalized.size),
        finalMimeType: normalized.mimeType,
        etag: String(finalObject?.etag || ''),
        width: normalized.width,
        height: normalized.height,
        publicUrl,
        processedAt,
        completedAt: processedAt,
        processingStartedAt: null,
        nextProcessingAt: null,
        lastProcessingError: '',
        failureCode: '',
        failureMessage: '',
      } },
      session ? { session } : undefined,
    )
    return true
  }

  if (!supportsTransactions) return persist(null)
  const session = await mongoose.startSession()
  try {
    let changed = false
    await session.withTransaction(async () => { changed = await persist(session) })
    return changed
  } finally {
    await session.endSession()
  }
}

const processClaimed = async (intent: any) => {
  const sourceKey = String(intent.uploadKey || intent.key)
  const originalFinalKey = String(intent.key)
  const finalKey = StoredFileSecurityService.canonicalPublicImageKey(originalFinalKey)
  const processingKey = processingKeyForIntent(intent)
  try {
    await TenantPurgeBarrier.assertTenantWritable(String(intent.organizationId))
    const head = await ObjectStorageService.head(sourceKey)
    const actualMime = String(head.contentType || '').split(';')[0].trim().toLowerCase()
    if (actualMime && actualMime !== 'application/octet-stream' && actualMime !== intent.mimeType) {
      throw new ApiError(400, 'Uploaded object type does not match the signed upload.', '', API_ERROR_CODES.UPLOAD_CONTENT_TYPE_MISMATCH)
    }
    if (Number(head.size) !== Number(intent.declaredSize) || Number(head.size) < 1 || Number(head.size) > MAX_DIRECT_UPLOAD_BYTES) {
      throw new ApiError(400, 'Uploaded object size does not match the declared file.', '', API_ERROR_CODES.UPLOAD_SIZE_MISMATCH)
    }

    await UploadIntent.updateOne({ _id: intent._id, status: 'verifying' }, { $set: { status: 'processing' } })
    intent.status = 'processing'

    try {
      await scanStoredObject(sourceKey)
    } catch (error: any) {
      if (Number(error?.statusCode || error?.status || 0) === 422) {
        throw new ApiError(422, 'This image failed malware scanning.', '', API_ERROR_CODES.IMAGE_MALWARE_REJECTED)
      }
      throw error
    }

    const normalized = await StoredFileSecurityService.prepareCanonicalPublicImage(
      sourceKey,
      String(intent.mimeType),
      imageContextForIntent(intent),
      { maxBytes: MAX_DIRECT_UPLOAD_BYTES + 4096 },
    )
    await EntitlementService.assertStorage(String(intent.organizationId), normalized.size)

    // Verify the converted bytes in the private staging bucket before the
    // canonical public key is written. A public object is never promoted from
    // unverified conversion output.
    await ObjectStorageService.putBuffer(processingKey, normalized.buffer, PROCESSING_MIME)
    const processedObject = await ObjectStorageService.head(processingKey)
    const processedMime = String(processedObject.contentType || '').split(';')[0].trim().toLowerCase()
    if (Number(processedObject.size) !== normalized.size || (processedMime && processedMime !== PROCESSING_MIME)) {
      throw new ApiError(503, 'Optimized WebP verification failed before promotion.', '', API_ERROR_CODES.IMAGE_STORAGE_VERIFICATION_FAILED)
    }

    await ObjectStorageService.putBuffer(finalKey, normalized.buffer, normalized.mimeType)
    const finalObject = await ObjectStorageService.head(finalKey)
    const finalMime = String(finalObject.contentType || '').split(';')[0].trim().toLowerCase()
    if (Number(finalObject.size) !== normalized.size || (finalMime && finalMime !== normalized.mimeType)) {
      throw new ApiError(503, 'Normalized image verification failed after promotion.', '', API_ERROR_CODES.IMAGE_STORAGE_VERIFICATION_FAILED)
    }

    const changed = await finalizeAccounting(intent, finalKey, finalObject, normalized)
    if (!changed) return false

    await ObjectStorageService.remove(processingKey).catch(() => undefined)
    if (sourceKey !== finalKey) await ObjectStorageService.remove(sourceKey).catch(() => undefined)
    if (originalFinalKey !== finalKey && originalFinalKey !== sourceKey) {
      await ObjectStorageService.remove(originalFinalKey).catch(() => undefined)
    }

    recordUploadSuccess({ kind: 'public-image', bytes: normalized.size })
    logger.info('direct_image_processing_ready', {
      event: 'direct_image_processing_ready',
      organizationId: intent.organizationId,
      uploadId: intent.uploadId,
      sourceMimeType: String(intent.mimeType),
      finalMimeType: normalized.mimeType,
      finalKey,
      originalBytes: Number(intent.actualSize || intent.declaredSize || 0),
      finalBytes: normalized.size,
      compressionRatio: Number(intent.actualSize || intent.declaredSize || 0) > 0
        ? Math.round((normalized.size / Number(intent.actualSize || intent.declaredSize)) * 10_000) / 100
        : undefined,
      width: normalized.width,
      height: normalized.height,
    })
    return true
  } catch (rawError: any) {
    const error = mappedProcessingError(rawError)
    await ObjectStorageService.remove(processingKey).catch(() => undefined)
    if (isSecurityRejection(error)) await rejectIntent(intent, error)
    else await scheduleRetry(intent, error)
    return false
  }
}

const claimNext = async () => {
  const now = new Date()
  const stale = new Date(Date.now() - DIRECT_UPLOAD_PROCESSING_LOCK_MS)
  return UploadIntent.findOneAndUpdate(
    {
      $or: [
        { status: 'uploaded', $or: [{ nextProcessingAt: null }, { nextProcessingAt: { $lte: now } }] },
        { status: { $in: ['verifying', 'processing'] }, processingStartedAt: { $lte: stale } },
      ],
    },
    { $set: { status: 'verifying', processingStartedAt: now }, $inc: { processingAttempts: 1 } },
    { new: true, sort: { uploadedAt: 1, createdAt: 1 } },
  )
}

const processBatch = async (limit = config.assets.image_processor_batch_size) => {
  let processed = 0
  let attempted = 0
  for (let i = 0; i < Math.max(1, Math.min(10, limit)); i += 1) {
    const intent: any = await claimNext()
    if (!intent) break
    attempted += 1
    if (await processClaimed(intent)) processed += 1
  }
  return { attempted, processed }
}

export const DirectUploadProcessor = { processBatch }
