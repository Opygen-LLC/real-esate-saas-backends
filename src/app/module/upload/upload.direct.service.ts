import { randomUUID } from 'crypto'
import mongoose from 'mongoose'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { logger } from '../../../shared/logger'
import { recordUploadSuccess } from '../../../shared/securityObservability'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { UsageBudgetService } from '../../security/usageBudget.service'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Organization } from '../organization/organization.model'
import { ObjectStorageService } from '../websiteBuilder/objectStorage.service'
import { StoredFileSecurityService } from '../websiteBuilder/storedFileSecurity.service'
import {
  DIRECT_UPLOAD_COMPLETED_RETENTION_MS,
  DIRECT_UPLOAD_COMPLETION_LOCK_MS,
  DIRECT_UPLOAD_INTENT_TTL_MS,
  MAX_DIRECT_UPLOAD_BYTES,
  normalizeUploadFolder,
  normalizeUploadMimeType,
  type UploadFolder,
  type UploadMimeType,
} from './upload.contract'
import { UploadIntent } from './uploadIntent.model'

export type DirectUploadPresignInput = {
  uploadId?: string
  filename: string
  mimeType: string
  size: number
  folder?: string
}

export type DirectUploadCompleteInput = {
  uploadId: string
  key: string
}

const SAFE_UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const safeStem = (filename: string): string => {
  const stem = String(filename || '')
    .replace(/\.[^.]+$/, '')
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return stem || 'image'
}

const extensionForMime = (mimeType: UploadMimeType): string => mimeType === 'image/png' ? 'png' : 'jpg'

const keyForUpload = (organizationId: string, folder: UploadFolder, filename: string, mimeType: UploadMimeType): string => {
  const now = new Date()
  const year = String(now.getUTCFullYear())
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const base = folder === 'property'
    ? `tenants/${organizationId}/properties/uploads/${year}/${month}`
    : `tenants/${organizationId}/uploads/${folder}/${year}/${month}`
  return `${base}/${randomUUID()}-${safeStem(filename)}.${extensionForMime(mimeType)}`
}

const validatePresignInput = (input: DirectUploadPresignInput) => {
  const filename = String(input?.filename || '').trim()
  const mimeType = normalizeUploadMimeType(input?.mimeType)
  const folder = normalizeUploadFolder(input?.folder)
  const size = Number(input?.size)

  StoredFileSecurityService.assertSafeUploadFilename(filename, mimeType)
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new ApiError(400, 'Image size must be a positive integer.', '', 'INVALID_UPLOAD_SIZE', undefined, {
      size: ['Choose a non-empty image.'],
    })
  }
  if (size > MAX_DIRECT_UPLOAD_BYTES) {
    throw new ApiError(413, 'Image must be 5 MB or smaller.', '', 'FILE_TOO_LARGE', undefined, {
      size: ['Choose an image that is 5 MB or smaller.'],
    })
  }

  const uploadId = input?.uploadId ? String(input.uploadId).trim() : ''
  if (uploadId && !SAFE_UPLOAD_ID.test(uploadId)) {
    throw new ApiError(400, 'Invalid upload id.', '', 'INVALID_UPLOAD_ID')
  }

  return { filename, mimeType, folder, size, uploadId }
}

const presentPresign = async (intent: any) => {
  const signed = ObjectStorageService.presignUpload(intent.key, intent.mimeType)
  return {
    uploadId: String(intent.uploadId),
    key: String(intent.key),
    uploadUrl: await signed.getUploadUrl(),
    expiresIn: signed.expiresIn,
  }
}

const presign = async (organizationId: string, userId: string, input: DirectUploadPresignInput) => {
  await TenantPurgeBarrier.assertTenantWritable(organizationId)
  const normalized = validatePresignInput(input)

  if (normalized.uploadId) {
    const existing: any = await UploadIntent.findOne({
      uploadId: normalized.uploadId,
      organizationId,
      userId,
    })
    if (!existing) throw new ApiError(404, 'Upload session was not found.', '', 'UPLOAD_INTENT_NOT_FOUND')
    if (existing.status === 'completed') {
      return {
        uploadId: existing.uploadId,
        key: existing.key,
        uploadUrl: '',
        publicUrl: existing.publicUrl || ObjectStorageService.publicUrl(existing.key),
        expiresIn: 0,
        completed: true,
      }
    }
    if (existing.status !== 'pending') throw new ApiError(409, 'Upload session cannot be refreshed.', '', 'UPLOAD_INTENT_NOT_PENDING')
    if (new Date(existing.expiresAt).getTime() <= Date.now()) {
      throw new ApiError(409, 'Upload session expired. Start the upload again.', '', 'UPLOAD_INTENT_EXPIRED')
    }
    if (
      existing.originalName !== normalized.filename
      || existing.mimeType !== normalized.mimeType
      || existing.folder !== normalized.folder
      || Number(existing.declaredSize) !== normalized.size
    ) {
      throw new ApiError(409, 'Upload metadata does not match the existing upload session.', '', 'UPLOAD_INTENT_MISMATCH')
    }
    return presentPresign(existing)
  }

  await EntitlementService.assertStorage(organizationId, normalized.size)
  await UsageBudgetService.reserveUploadBytes(organizationId, normalized.size)

  const uploadId = randomUUID()
  const key = keyForUpload(organizationId, normalized.folder, normalized.filename, normalized.mimeType)
  const intent = await UploadIntent.create({
    uploadId,
    organizationId,
    userId,
    key,
    folder: normalized.folder,
    originalName: normalized.filename,
    mimeType: normalized.mimeType,
    declaredSize: normalized.size,
    status: 'pending',
    expiresAt: new Date(Date.now() + DIRECT_UPLOAD_INTENT_TTL_MS),
  })

  try {
    return await presentPresign(intent)
  } catch (error) {
    await UploadIntent.deleteOne({ _id: intent._id, status: 'pending' }).catch(() => undefined)
    throw error
  }
}

const completedResult = (intent: any) => ({
  uploadId: String(intent.uploadId),
  key: String(intent.key),
  publicUrl: String(intent.publicUrl || ObjectStorageService.publicUrl(intent.key)),
  sizeBytes: Number(intent.actualSize || intent.declaredSize || 0),
})

const rejectIntent = async (intent: any, error: ApiError): Promise<never> => {
  await Promise.allSettled([
    ObjectStorageService.remove(intent.key),
    UploadIntent.updateOne(
      { _id: intent._id, status: 'completing' },
      { $set: { status: 'rejected', completionStartedAt: null } },
    ),
  ])
  throw error
}

const complete = async (organizationId: string, userId: string, input: DirectUploadCompleteInput) => {
  await TenantPurgeBarrier.assertTenantWritable(organizationId)
  const uploadId = String(input?.uploadId || '').trim()
  const key = String(input?.key || '').trim()
  if (!SAFE_UPLOAD_ID.test(uploadId) || !key) throw new ApiError(400, 'uploadId and key are required.', '', 'INVALID_UPLOAD_COMPLETION')
  if (!key.startsWith(`tenants/${organizationId}/`)) throw new ApiError(403, 'Upload key does not belong to this organization.', '', 'UPLOAD_KEY_FORBIDDEN')

  const initial: any = await UploadIntent.findOne({ uploadId, organizationId, userId })
  if (!initial) throw new ApiError(404, 'Upload session was not found.', '', 'UPLOAD_INTENT_NOT_FOUND')
  if (initial.key !== key) throw new ApiError(409, 'Upload key does not match its upload session.', '', 'UPLOAD_INTENT_MISMATCH')
  if (initial.status === 'completed') return completedResult(initial)
  if (initial.status === 'rejected') throw new ApiError(409, 'This upload was rejected. Start a new upload.', '', 'UPLOAD_INTENT_REJECTED')
  if (new Date(initial.expiresAt).getTime() <= Date.now()) throw new ApiError(409, 'Upload session expired. Start the upload again.', '', 'UPLOAD_INTENT_EXPIRED')

  const transactionsSupported = await mongoSupportsTransactions()
  if (config.isProduction && !transactionsSupported) {
    throw new ApiError(503, 'Direct upload completion requires a transaction-capable MongoDB deployment.', '', 'UPLOAD_COMPLETION_UNAVAILABLE')
  }

  const completionStartedAt = new Date()
  const staleCompletionBefore = new Date(Date.now() - DIRECT_UPLOAD_COMPLETION_LOCK_MS)
  const locked: any = await UploadIntent.findOneAndUpdate(
    {
      _id: initial._id,
      $or: [
        { status: 'pending' },
        { status: 'completing', completionStartedAt: { $lte: staleCompletionBefore } },
      ],
    },
    { $set: { status: 'completing', completionStartedAt } },
    { new: true },
  )
  if (!locked) {
    const current: any = await UploadIntent.findById(initial._id)
    if (current?.status === 'completed') return completedResult(current)
    throw new ApiError(409, 'Upload completion is already in progress. Retry shortly.', '', 'UPLOAD_COMPLETION_IN_PROGRESS')
  }

  let object
  try {
    object = await ObjectStorageService.head(key)
  } catch (error: any) {
    await UploadIntent.updateOne({ _id: locked._id, status: 'completing' }, { $set: { status: 'pending', completionStartedAt: null } })
    if (error instanceof ApiError && error.statusCode === 409 && /not available/i.test(error.message)) {
      throw new ApiError(409, 'Uploaded object is not available yet.', '', 'UPLOAD_OBJECT_NOT_FOUND')
    }
    throw error
  }

  const actualMime = String(object.contentType || '').split(';')[0].trim().toLowerCase()
  if (actualMime !== locked.mimeType) {
    return rejectIntent(locked, new ApiError(400, 'Uploaded object type does not match the signed upload.', '', 'UPLOAD_CONTENT_TYPE_MISMATCH'))
  }
  if (Number(object.size) !== Number(locked.declaredSize) || Number(object.size) < 1 || Number(object.size) > MAX_DIRECT_UPLOAD_BYTES) {
    return rejectIntent(locked, new ApiError(400, 'Uploaded object size does not match the declared file.', '', 'UPLOAD_SIZE_MISMATCH'))
  }

  try {
    await EntitlementService.assertStorage(organizationId, Number(object.size))
  } catch (error) {
    if (error instanceof ApiError && error.statusCode < 500) {
      return rejectIntent(locked, error)
    }
    await UploadIntent.updateOne(
      { _id: locked._id, status: 'completing' },
      { $set: { status: 'pending', completionStartedAt: null } },
    ).catch(() => undefined)
    throw error
  }

  const publicUrl = ObjectStorageService.publicUrl(key)
  const finishedAt = new Date()

  const persist = async (session: mongoose.ClientSession | null) => {
    const intentQuery = UploadIntent.findOne({ _id: locked._id, organizationId, status: 'completing' })
    if (session) intentQuery.session(session)
    const current: any = await intentQuery
    if (!current) throw new ApiError(409, 'Upload completion state changed. Retry shortly.', '', 'UPLOAD_COMPLETION_IN_PROGRESS')

    await Organization.updateOne(
      { organizationId },
      { $inc: { storageUsedBytes: Number(object.size) } },
      session ? { session } : undefined,
    )
    await UploadIntent.updateOne(
      { _id: current._id, status: 'completing' },
      { $set: { status: 'completed', actualSize: Number(object.size), publicUrl, completedAt: finishedAt, completionStartedAt: null } },
      session ? { session } : undefined,
    )
  }

  if (transactionsSupported) {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(() => persist(session))
    } catch (error) {
      await UploadIntent.updateOne({ _id: locked._id, status: 'completing' }, { $set: { status: 'pending', completionStartedAt: null } }).catch(() => undefined)
      throw error
    } finally {
      await session.endSession()
    }
  } else {
    try {
      await persist(null)
    } catch (error) {
      await UploadIntent.updateOne({ _id: locked._id, status: 'completing' }, { $set: { status: 'pending', completionStartedAt: null } }).catch(() => undefined)
      throw error
    }
  }

  recordUploadSuccess({ kind: 'public-image', bytes: Number(object.size) })
  logger.info('direct_upload_completed', {
    event: 'direct_upload_completed',
    organizationId,
    uploadId,
    folder: locked.folder,
    sizeBytes: Number(object.size),
  })

  const completed: any = await UploadIntent.findById(locked._id)
  return completedResult(completed || { ...locked.toObject(), status: 'completed', actualSize: object.size, publicUrl })
}



const cleanupExpired = async (limit = 100) => {
  const now = new Date()
  const staleCompletedBefore = new Date(Date.now() - DIRECT_UPLOAD_COMPLETED_RETENTION_MS)
  const [incomplete, completed] = await Promise.all([
    UploadIntent.find({ status: { $in: ['pending', 'completing', 'rejected'] }, expiresAt: { $lte: now } }).sort({ expiresAt: 1 }).limit(limit),
    UploadIntent.find({ status: 'completed', completedAt: { $lte: staleCompletedBefore } }).sort({ completedAt: 1 }).limit(limit),
  ])

  let incompleteDeleted = 0
  for (const intent of incomplete) {
    await ObjectStorageService.remove(intent.key).catch(() => undefined)
    await intent.deleteOne()
    incompleteDeleted += 1
  }
  if (completed.length) {
    await UploadIntent.deleteMany({ _id: { $in: completed.map((intent) => intent._id) }, status: 'completed' })
  }
  return { incompleteDeleted, completedIntentsDeleted: completed.length }
}

export const DirectUploadService = { presign, complete, cleanupExpired }
