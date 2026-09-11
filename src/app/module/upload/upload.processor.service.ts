import mongoose from 'mongoose'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { logger } from '../../../shared/logger'
import { recordUploadSuccess } from '../../../shared/securityObservability'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Organization } from '../organization/organization.model'
import { ObjectStorageService } from '../websiteBuilder/objectStorage.service'
import { StoredFileSecurityService } from '../websiteBuilder/storedFileSecurity.service'
import { scanStoredObject } from '../websiteBuilder/virusScan.service'
import {
  DIRECT_UPLOAD_MAX_STORED_DIMENSION,
  DIRECT_UPLOAD_PROCESSING_LOCK_MS,
  MAX_DIRECT_UPLOAD_BYTES,
} from './upload.contract'
import { UploadIntent } from './uploadIntent.model'

const MAX_PROCESSING_ATTEMPTS = 5

const safeErrorMessage = (error: any): string => String(error?.message || 'image_processing_failed').slice(0, 240)
const isSecurityRejection = (error: any): boolean => {
  const status = Number(error?.statusCode || error?.status || 0)
  return status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429
}

const rejectIntent = async (intent: any, error: any) => {
  const code = String(error?.errorCode || error?.code || 'IMAGE_PROCESSING_REJECTED').slice(0, 80)
  const message = safeErrorMessage(error)
  await UploadIntent.updateOne(
    { _id: intent._id, status: { $in: ['verifying', 'processing', 'uploaded'] } },
    { $set: { status: 'rejected', failureCode: code, failureMessage: message, lastProcessingError: message, completedAt: new Date() } },
  )
  const keys = Array.from(new Set([String(intent.uploadKey || ''), String(intent.key || '')].filter(Boolean)))
  await Promise.allSettled(keys.map((key) => ObjectStorageService.remove(key)))
  logger.warn('direct_image_processing_rejected', { organizationId: intent.organizationId, uploadId: intent.uploadId, code })
}

const scheduleRetry = async (intent: any, error: any) => {
  const attempts = Number(intent.processingAttempts || 1)
  if (attempts >= MAX_PROCESSING_ATTEMPTS) {
    await rejectIntent(intent, new ApiError(422, 'Image processing failed after multiple attempts.', '', 'IMAGE_PROCESSING_FAILED'))
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

const finalizeAccounting = async (intent: any, finalObject: any, normalized: { width: number; height: number; size: number }) => {
  const supportsTransactions = await mongoSupportsTransactions()
  if (config.isProduction && !supportsTransactions) throw new ApiError(503, 'Image processing requires transaction-capable MongoDB.', '', 'IMAGE_PROCESSING_UNAVAILABLE')
  const publicUrl = ObjectStorageService.publicImageUrl(String(intent.key))
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
        finalSize: Number(normalized.size),
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
  try {
    await TenantPurgeBarrier.assertTenantWritable(String(intent.organizationId))
    const head = await ObjectStorageService.head(sourceKey)
    const actualMime = String(head.contentType || '').split(';')[0].trim().toLowerCase()
    if (actualMime && actualMime !== 'application/octet-stream' && actualMime !== intent.mimeType) {
      throw new ApiError(400, 'Uploaded object type does not match the signed upload.', '', 'UPLOAD_CONTENT_TYPE_MISMATCH')
    }
    if (Number(head.size) !== Number(intent.declaredSize) || Number(head.size) < 1 || Number(head.size) > MAX_DIRECT_UPLOAD_BYTES) {
      throw new ApiError(400, 'Uploaded object size does not match the declared file.', '', 'UPLOAD_SIZE_MISMATCH')
    }

    await UploadIntent.updateOne({ _id: intent._id, status: 'verifying' }, { $set: { status: 'processing' } })
    intent.status = 'processing'
    await scanStoredObject(sourceKey)
    const normalized = await StoredFileSecurityService.prepareStoredPublicImage(sourceKey, String(intent.mimeType), {
      maxBytes: MAX_DIRECT_UPLOAD_BYTES + 4096,
      maxWidth: DIRECT_UPLOAD_MAX_STORED_DIMENSION,
      maxHeight: DIRECT_UPLOAD_MAX_STORED_DIMENSION,
    })
    await EntitlementService.assertStorage(String(intent.organizationId), normalized.size)
    await ObjectStorageService.putBuffer(String(intent.key), normalized.buffer, String(intent.mimeType))
    const finalObject = await ObjectStorageService.head(String(intent.key))
    if (Number(finalObject.size) !== normalized.size) throw new ApiError(503, 'Normalized image verification failed.', '', 'IMAGE_STORAGE_VERIFICATION_FAILED')
    const changed = await finalizeAccounting(intent, finalObject, normalized)
    if (!changed) return false

    if (sourceKey !== String(intent.key)) await ObjectStorageService.remove(sourceKey).catch(() => undefined)
    recordUploadSuccess({ kind: 'public-image', bytes: normalized.size })
    logger.info('direct_image_processing_ready', {
      event: 'direct_image_processing_ready',
      organizationId: intent.organizationId,
      uploadId: intent.uploadId,
      originalBytes: Number(intent.actualSize || intent.declaredSize || 0),
      finalBytes: normalized.size,
      width: normalized.width,
      height: normalized.height,
    })
    return true
  } catch (error: any) {
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
