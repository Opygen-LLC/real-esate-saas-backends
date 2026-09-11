import { API_ERROR_CODES } from '../../../contracts/apiContract'
import ApiError from '../../../errors/ApiError'
import type { ImageUploadContext } from '../../helpers/imageUploadPolicy'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Organization } from '../organization/organization.model'
import { ObjectStorageService } from './objectStorage.service'
import { scanStoredObject } from './virusScan.service'
import { WebsiteAsset } from './websiteAsset.model'
import { WebsiteUploadIntent } from './websiteUploadIntent.model'
import { StoredFileSecurityService } from './storedFileSecurity.service'

const PROCESSING_MIME = 'image/webp'

const processingKeyForAsset = (organizationId: string, assetId: string): string =>
  `tenants/${organizationId}/upload-staging/processed/website-${assetId}.webp`

const imageContextForAsset = (asset: any): ImageUploadContext =>
  ['property', 'property-draft'].includes(String(asset.context || '')) ? 'property' : 'website'

const failureCodeFor = (error: any): string => {
  const statusCode = Number(error?.statusCode || error?.status || 0)
  if (statusCode === 422 && !error?.errorCode && !error?.code) return API_ERROR_CODES.IMAGE_MALWARE_REJECTED
  return String(error?.errorCode || error?.code || API_ERROR_CODES.IMAGE_PROCESSING_FAILED).slice(0, 80)
}

const finalize = async (organizationId: string, assetId: string, payload: any) => {
  const asset: any = await WebsiteAsset.findOne({ _id: assetId, organizationId })
  if (!asset) return null
  if (asset.status === 'ready') return asset

  const originalAssetKey = String(asset.key)
  const intent: any = await WebsiteUploadIntent.findOne({ organizationId, key: originalAssetKey })
  if (!intent) throw new ApiError(409, 'Upload intent expired before asset processing completed')

  const sourceKey = String(intent.uploadKey || originalAssetKey)
  const isImage = String(asset.mimeType).startsWith('image/')
  const finalKey = isImage
    ? StoredFileSecurityService.canonicalPublicImageKey(originalAssetKey)
    : originalAssetKey
  const processingKey = isImage ? processingKeyForAsset(organizationId, String(asset._id)) : ''

  try {
    const source = await ObjectStorageService.head(sourceKey)
    const actualMime = String(source.contentType || '').split(';')[0].trim().toLowerCase()
    if (actualMime && actualMime !== 'application/octet-stream' && actualMime !== asset.mimeType) {
      throw new ApiError(400, 'Uploaded object content type does not match its signed upload', '', API_ERROR_CODES.UPLOAD_CONTENT_TYPE_MISMATCH)
    }
    const declaredSize = Number(intent.declaredSize || 0)
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 1 || declaredSize > 5 * 1024 * 1024) {
      throw new ApiError(400, 'Upload intent has an invalid declared size', '', API_ERROR_CODES.UPLOAD_SIZE_MISMATCH)
    }
    if (Number(source.size) !== declaredSize) {
      throw new ApiError(400, 'Uploaded object size does not match its signed upload intent', '', API_ERROR_CODES.UPLOAD_SIZE_MISMATCH)
    }

    let scan: { status: 'clean' | 'skipped'; detail: string }
    try {
      scan = await scanStoredObject(sourceKey)
    } catch (error: any) {
      if (isImage && Number(error?.statusCode || error?.status || 0) === 422) {
        throw new ApiError(422, 'This image failed malware scanning.', '', API_ERROR_CODES.IMAGE_MALWARE_REJECTED)
      }
      throw error
    }

    let width = Number(asset.width || 0) || undefined
    let height = Number(asset.height || 0) || undefined
    let finalSize = 0
    let finalMimeType = String(asset.mimeType)

    if (isImage) {
      const prepared = await StoredFileSecurityService.prepareCanonicalPublicImage(
        sourceKey,
        String(asset.mimeType),
        imageContextForAsset(asset),
        { maxBytes: Math.max(25 * 1024 * 1024, Number(intent.declaredSize || 0) + 4096) },
      )
      await EntitlementService.assertStorage(organizationId, prepared.size)

      // Store the converted WebP in the private staging bucket first and verify
      // its size/type before making the canonical public object reachable.
      await ObjectStorageService.putBuffer(processingKey, prepared.buffer, PROCESSING_MIME)
      const processed = await ObjectStorageService.head(processingKey)
      const processedMime = String(processed.contentType || '').split(';')[0].trim().toLowerCase()
      if (Number(processed.size) !== prepared.size || (processedMime && processedMime !== PROCESSING_MIME)) {
        throw new ApiError(503, 'Optimized WebP verification failed before promotion.', '', API_ERROR_CODES.IMAGE_STORAGE_VERIFICATION_FAILED)
      }

      await ObjectStorageService.putBuffer(finalKey, prepared.buffer, prepared.mimeType)
      const promoted = await ObjectStorageService.head(finalKey)
      const promotedMime = String(promoted.contentType || '').split(';')[0].trim().toLowerCase()
      if (Number(promoted.size) !== prepared.size || (promotedMime && promotedMime !== prepared.mimeType)) {
        throw new ApiError(503, 'Processed asset verification failed after promotion.', '', API_ERROR_CODES.IMAGE_STORAGE_VERIFICATION_FAILED)
      }

      width = prepared.width
      height = prepared.height
      finalSize = prepared.size
      finalMimeType = prepared.mimeType
    } else {
      // Private/non-image files keep their original bytes and content type.
      const validated = await StoredFileSecurityService.validateStoredFile(
        sourceKey,
        asset.mimeType,
        Math.max(25 * 1024 * 1024, Number(intent.declaredSize || 0) + 4096),
      )
      await EntitlementService.assertStorage(organizationId, validated.size)
      if (sourceKey !== finalKey) await ObjectStorageService.putBuffer(finalKey, validated.body, asset.mimeType)
      finalSize = validated.size
    }

    // Legacy Phase 3 intents may still contain browser-created variants during a
    // rolling deploy. Keep them readable, but new uploads create no variants.
    const variants: any[] = []
    for (const variant of payload.variants || []) {
      if (!String(variant.key).startsWith(`${originalAssetKey}.`) || !intent.objectKeys.includes(String(variant.key))) {
        throw new ApiError(400, 'Invalid asset variant key')
      }
      let meta = await ObjectStorageService.head(variant.key)
      const expectedMime = `image/${variant.format}`
      const variantMime = String(meta.contentType || '').split(';')[0].trim().toLowerCase()
      if (variantMime && variantMime !== 'application/octet-stream' && variantMime !== expectedMime) {
        throw new ApiError(400, `Asset variant content type must be ${expectedMime}`)
      }
      await scanStoredObject(variant.key)
      const sanitizedVariant = await StoredFileSecurityService.sanitizeStoredPublicImage(variant.key, expectedMime, {
        maxWidth: Number(variant.width) || 1280,
        maxHeight: Number(variant.width) || 1280,
        maxBytes: 5 * 1024 * 1024,
      })
      meta = await ObjectStorageService.head(variant.key)
      variants.push({
        key: variant.key,
        url: ObjectStorageService.publicImageUrl(variant.key),
        format: variant.format,
        width: sanitizedVariant.width || Number(variant.width),
        height: sanitizedVariant.height,
        size: meta.size,
      })
    }

    const original = await ObjectStorageService.head(finalKey)
    if (Number(original.size) !== finalSize) {
      throw new ApiError(503, 'Processed asset verification failed', '', API_ERROR_CODES.IMAGE_STORAGE_VERIFICATION_FAILED)
    }
    const totalSize = Number(original.size) + variants.reduce((sum: number, variant: any) => sum + Number(variant.size || 0), 0)
    const previousSize = Number(asset.size || 0)
    const storageDelta = Math.max(0, totalSize - previousSize)
    if (storageDelta) await EntitlementService.assertStorage(organizationId, storageDelta)

    asset.key = finalKey
    asset.url = isImage ? ObjectStorageService.publicImageUrl(finalKey) : ObjectStorageService.publicUrl(finalKey)
    asset.mimeType = finalMimeType
    asset.width = width
    asset.height = height
    asset.size = totalSize
    asset.etag = original.etag
    asset.scanStatus = scan.status
    asset.failureCode = ''
    asset.failureMessage = ''
    asset.variants = variants
    asset.status = 'ready'
    asset.lastReferencedAt = new Date()
    await asset.save()

    const delta = totalSize - previousSize
    if (delta) await Organization.updateOne({ organizationId }, { $inc: { storageUsedBytes: delta } })

    if (processingKey) await ObjectStorageService.remove(processingKey).catch(() => undefined)
    if (sourceKey !== finalKey) await ObjectStorageService.remove(sourceKey).catch(() => undefined)
    if (originalAssetKey !== finalKey && originalAssetKey !== sourceKey) {
      await ObjectStorageService.remove(originalAssetKey).catch(() => undefined)
    }
    await intent.deleteOne()
    return asset
  } catch (error: any) {
    if (processingKey) await ObjectStorageService.remove(processingKey).catch(() => undefined)
    const statusCode = Number(error?.statusCode || error?.status || 0)
    const securityRejected = statusCode >= 400 && statusCode < 500
    if (securityRejected) {
      asset.status = 'rejected'
      asset.scanStatus = statusCode === 422 ? 'infected' : 'failed'
      asset.failureCode = failureCodeFor(error)
      asset.failureMessage = String(error?.message || 'We could not safely process this image. Please choose another photo.').slice(0, 240)
      await asset.save()
      const keys = Array.from(new Set([
        ...(intent.objectKeys || []),
        sourceKey,
        originalAssetKey,
        finalKey,
        processingKey,
      ].filter(Boolean)))
      await Promise.allSettled(keys.map((key: string) => ObjectStorageService.remove(key)))
      await intent.deleteOne()
    }
    throw error
  }
}

export const WebsiteAssetProcessor = { finalize }
