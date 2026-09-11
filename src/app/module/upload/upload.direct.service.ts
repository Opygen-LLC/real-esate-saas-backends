import { randomUUID } from 'crypto'
import ApiError from '../../../errors/ApiError'
import { UsageBudgetService } from '../../security/usageBudget.service'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { ObjectStorageService } from '../websiteBuilder/objectStorage.service'
import { StoredFileSecurityService } from '../websiteBuilder/storedFileSecurity.service'
import { assertImageUploadFilename, assertImageUploadSize } from '../../helpers/imageUploadPolicy'
import {
  DIRECT_UPLOAD_COMPLETED_RETENTION_MS,
  DIRECT_UPLOAD_INTENT_TTL_MS,
  MAX_DIRECT_UPLOAD_BYTES,
  normalizeUploadFolder,
  normalizeUploadMimeType,
  type DirectUploadStatus,
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

const extensionForMime = (mimeType: UploadMimeType): string => {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/avif') return 'avif'
  return 'jpg'
}

const finalKeyForUpload = (organizationId: string, folder: UploadFolder, filename: string): string => {
  const now = new Date()
  const year = String(now.getUTCFullYear())
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const base = folder === 'property'
    ? `tenants/${organizationId}/properties/uploads/${year}/${month}`
    : `tenants/${organizationId}/uploads/${folder}/${year}/${month}`
  return `${base}/${randomUUID()}-${safeStem(filename)}.webp`
}

const stagingKeyForUpload = (organizationId: string, filename: string, mimeType: UploadMimeType): string =>
  `tenants/${organizationId}/upload-staging/generic/${randomUUID()}-${safeStem(filename)}.${extensionForMime(mimeType)}`

const validatePresignInput = (input: DirectUploadPresignInput) => {
  const filename = String(input?.filename || '').trim()
  const mimeType = normalizeUploadMimeType(input?.mimeType)
  const folder = normalizeUploadFolder(input?.folder)
  const size = Number(input?.size)

  assertImageUploadFilename(filename, mimeType)
  assertImageUploadSize(size, folder)

  const uploadId = input?.uploadId ? String(input.uploadId).trim() : ''
  if (uploadId && !SAFE_UPLOAD_ID.test(uploadId)) {
    throw new ApiError(400, 'Invalid upload id.', '', 'INVALID_UPLOAD_ID')
  }

  return { filename, mimeType, folder, size, uploadId }
}

const responseStatus = (raw: string): DirectUploadStatus => {
  if (raw === 'pending') return 'presigned'
  if (raw === 'completing') return 'verifying'
  if (raw === 'completed') return 'ready'
  if (['presigned', 'uploaded', 'verifying', 'processing', 'ready', 'rejected'].includes(raw)) return raw as DirectUploadStatus
  return 'rejected'
}

const presentStatus = (intent: any) => {
  const status = responseStatus(String(intent.status || ''))
  const ready = status === 'ready'
  return {
    uploadId: String(intent.uploadId),
    status,
    key: ready ? String(intent.key) : undefined,
    publicUrl: ready ? String(intent.publicUrl || ObjectStorageService.publicImageUrl(intent.key)) : undefined,
    sizeBytes: ready ? Number(intent.finalSize || intent.actualSize || intent.declaredSize || 0) : Number(intent.actualSize || intent.declaredSize || 0),
    mimeType: ready ? String(intent.finalMimeType || 'image/webp') : String(intent.mimeType || ''),
    etag: ready && intent.etag ? String(intent.etag) : undefined,
    width: ready && Number(intent.width || 0) > 0 ? Number(intent.width) : undefined,
    height: ready && Number(intent.height || 0) > 0 ? Number(intent.height) : undefined,
    error: status === 'rejected' ? {
      code: String(intent.failureCode || 'IMAGE_PROCESSING_REJECTED'),
      message: String(intent.failureMessage || 'The image could not be processed safely.'),
    } : undefined,
  }
}

const presentPresign = async (intent: any) => {
  const uploadKey = String(intent.uploadKey || intent.key)
  const signed = ObjectStorageService.presignUpload(uploadKey, intent.mimeType)
  return {
    uploadId: String(intent.uploadId),
    key: uploadKey,
    uploadUrl: await signed.getUploadUrl(),
    expiresIn: signed.expiresIn,
    contentType: String(intent.mimeType || ''),
  }
}

const presign = async (organizationId: string, userId: string, input: DirectUploadPresignInput) => {
  await TenantPurgeBarrier.assertTenantWritable(organizationId)
  const normalized = validatePresignInput(input)

  if (normalized.uploadId) {
    const existing: any = await UploadIntent.findOne({ uploadId: normalized.uploadId, organizationId, userId })
    if (!existing) throw new ApiError(404, 'Upload session was not found.', '', 'UPLOAD_INTENT_NOT_FOUND')
    const status = responseStatus(String(existing.status || ''))
    if (status === 'ready') return { ...presentStatus(existing), uploadUrl: '', expiresIn: 0, completed: true }
    if (status !== 'presigned') throw new ApiError(409, 'Upload session cannot be refreshed after upload completion has started.', '', 'UPLOAD_INTENT_NOT_PRESIGNED')
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
  const key = finalKeyForUpload(organizationId, normalized.folder, normalized.filename)
  const uploadKey = stagingKeyForUpload(organizationId, normalized.filename, normalized.mimeType)
  const intent = await UploadIntent.create({
    uploadId,
    organizationId,
    userId,
    key,
    uploadKey,
    folder: normalized.folder,
    originalName: normalized.filename,
    mimeType: normalized.mimeType,
    declaredSize: normalized.size,
    status: 'presigned',
    expiresAt: new Date(Date.now() + DIRECT_UPLOAD_INTENT_TTL_MS),
  })

  try {
    return await presentPresign(intent)
  } catch (error) {
    await UploadIntent.deleteOne({ _id: intent._id, status: 'presigned' }).catch(() => undefined)
    throw error
  }
}

const rejectBeforeProcessing = async (intent: any, code: string, message: string, statusCode = 400): Promise<never> => {
  await Promise.allSettled([
    ObjectStorageService.remove(String(intent.uploadKey || intent.key)),
    intent.uploadKey && intent.uploadKey !== intent.key ? ObjectStorageService.remove(String(intent.key)) : Promise.resolve(),
    UploadIntent.updateOne(
      { _id: intent._id, status: { $in: ['presigned', 'pending'] } },
      { $set: { status: 'rejected', failureCode: code, failureMessage: message, completedAt: new Date() } },
    ),
  ])
  throw new ApiError(statusCode, message, '', code)
}

/**
 * Completion deliberately performs only cheap object metadata checks. CPU-heavy
 * decoding, malware scanning and normalization are performed by the dedicated
 * image worker after this request returns.
 */
const complete = async (organizationId: string, userId: string, input: DirectUploadCompleteInput) => {
  await TenantPurgeBarrier.assertTenantWritable(organizationId)
  const uploadId = String(input?.uploadId || '').trim()
  const suppliedKey = String(input?.key || '').trim()
  if (!SAFE_UPLOAD_ID.test(uploadId) || !suppliedKey) throw new ApiError(400, 'uploadId and key are required.', '', 'INVALID_UPLOAD_COMPLETION')
  if (!suppliedKey.startsWith(`tenants/${organizationId}/`)) throw new ApiError(403, 'Upload key does not belong to this organization.', '', 'UPLOAD_KEY_FORBIDDEN')

  const intent: any = await UploadIntent.findOne({ uploadId, organizationId, userId })
  if (!intent) throw new ApiError(404, 'Upload session was not found.', '', 'UPLOAD_INTENT_NOT_FOUND')
  const expectedUploadKey = String(intent.uploadKey || intent.key)
  if (expectedUploadKey !== suppliedKey) throw new ApiError(409, 'Upload key does not match its upload session.', '', 'UPLOAD_INTENT_MISMATCH')
  const currentStatus = responseStatus(String(intent.status || ''))
  if (currentStatus === 'ready' || ['uploaded', 'verifying', 'processing'].includes(currentStatus)) return presentStatus(intent)
  if (currentStatus === 'rejected') throw new ApiError(409, 'This upload was rejected. Start a new upload.', '', 'UPLOAD_INTENT_REJECTED')
  if (new Date(intent.expiresAt).getTime() <= Date.now()) throw new ApiError(409, 'Upload session expired. Start the upload again.', '', 'UPLOAD_INTENT_EXPIRED')

  let object: { size: number; contentType: string; etag?: string }
  try {
    object = await ObjectStorageService.head(expectedUploadKey)
  } catch (error: any) {
    if (error instanceof ApiError && (error.statusCode === 404 || error.statusCode === 409 || /not available/i.test(error.message))) {
      throw new ApiError(409, 'Uploaded object is not available yet.', '', 'UPLOAD_OBJECT_NOT_FOUND')
    }
    throw error
  }

  const actualMime = String(object.contentType || '').split(';')[0].trim().toLowerCase()
  if (actualMime && actualMime !== 'application/octet-stream' && actualMime !== intent.mimeType) {
    return rejectBeforeProcessing(intent, 'UPLOAD_CONTENT_TYPE_MISMATCH', 'Uploaded object type does not match the signed upload.')
  }
  if (Number(object.size) !== Number(intent.declaredSize) || Number(object.size) < 1 || Number(object.size) > MAX_DIRECT_UPLOAD_BYTES) {
    return rejectBeforeProcessing(intent, 'UPLOAD_SIZE_MISMATCH', 'Uploaded object size does not match the declared file.')
  }

  await EntitlementService.assertStorage(organizationId, Number(object.size))
  const uploadedAt = new Date()
  await UploadIntent.updateOne(
    { _id: intent._id, status: { $in: ['presigned', 'pending'] } },
    { $set: { status: 'uploaded', actualSize: Number(object.size), uploadedAt, nextProcessingAt: uploadedAt, lastProcessingError: '' } },
  )
  const updated: any = await UploadIntent.findById(intent._id)
  return presentStatus(updated || { ...intent.toObject(), status: 'uploaded', actualSize: object.size })
}

const status = async (organizationId: string, userId: string, uploadId: string) => {
  const normalized = String(uploadId || '').trim()
  if (!SAFE_UPLOAD_ID.test(normalized)) throw new ApiError(400, 'Invalid upload id.', '', 'INVALID_UPLOAD_ID')
  const intent: any = await UploadIntent.findOne({ uploadId: normalized, organizationId, userId })
  if (!intent) throw new ApiError(404, 'Upload session was not found.', '', 'UPLOAD_INTENT_NOT_FOUND')
  return presentStatus(intent)
}

const cleanupExpired = async (limit = 100) => {
  const now = new Date()
  const staleCompletedBefore = new Date(Date.now() - DIRECT_UPLOAD_COMPLETED_RETENTION_MS)
  const incomplete: any[] = await UploadIntent.find({
    status: { $in: ['pending', 'completing', 'presigned', 'uploaded', 'verifying', 'processing', 'rejected'] },
    expiresAt: { $lte: now },
  }).sort({ expiresAt: 1 }).limit(limit)
  const completed: any[] = await UploadIntent.find({
    status: { $in: ['completed', 'ready'] },
    $or: [
      { processedAt: { $lte: staleCompletedBefore } },
      { completedAt: { $lte: staleCompletedBefore } },
    ],
  }).sort({ completedAt: 1 }).limit(limit)

  let incompleteDeleted = 0
  for (const intent of incomplete) {
    const keys = Array.from(new Set([String(intent.uploadKey || ''), String(intent.key || '')].filter(Boolean)))
    await Promise.allSettled(keys.map((key) => ObjectStorageService.remove(key)))
    await intent.deleteOne()
    incompleteDeleted += 1
  }
  if (completed.length) {
    await UploadIntent.deleteMany({ _id: { $in: completed.map((intent) => intent._id) }, status: { $in: ['completed', 'ready'] } })
  }
  return { incompleteDeleted, completedIntentsDeleted: completed.length }
}

export const DirectUploadService = { presign, complete, status, cleanupExpired }
