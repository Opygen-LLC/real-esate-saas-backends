import ApiError from '../../../errors/ApiError'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Organization } from '../organization/organization.model'
import { ObjectStorageService } from './objectStorage.service'
import { scanStoredObject } from './virusScan.service'
import { WebsiteAsset } from './websiteAsset.model'
import { WebsiteUploadIntent } from './websiteUploadIntent.model'
import { StoredFileSecurityService } from './storedFileSecurity.service'

const finalize = async (organizationId: string, assetId: string, payload: any) => {
  const asset: any = await WebsiteAsset.findOne({ _id: assetId, organizationId })
  if (!asset) return null
  if (asset.status === 'ready') return asset
  const intent: any = await WebsiteUploadIntent.findOne({ organizationId, key: asset.key })
  if (!intent) throw new ApiError(409, 'Upload intent expired before asset processing completed')

  const sourceKey = String(intent.uploadKey || asset.key)
  try {
    const source = await ObjectStorageService.head(sourceKey)
    const actualMime = String(source.contentType || '').split(';')[0].trim().toLowerCase()
    if (actualMime && actualMime !== 'application/octet-stream' && actualMime !== asset.mimeType) {
      throw new ApiError(400, 'Uploaded object content type does not match its signed upload')
    }
    const declaredSize = Number(intent.declaredSize || 0)
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 1 || declaredSize > 20 * 1024 * 1024) {
      throw new ApiError(400, 'Upload intent has an invalid declared size')
    }
    if (Number(source.size) !== declaredSize) {
      throw new ApiError(400, 'Uploaded object size does not match its signed upload intent')
    }

    const scan = await scanStoredObject(sourceKey)
    let width = Number(asset.width || 0) || undefined
    let height = Number(asset.height || 0) || undefined
    let finalSize = 0

    if (String(asset.mimeType).startsWith('image/')) {
      const prepared = await StoredFileSecurityService.prepareStoredPublicImage(sourceKey, asset.mimeType, {
        maxBytes: Math.max(25 * 1024 * 1024, Number(intent.declaredSize || 0) + 4096),
      })
      await EntitlementService.assertStorage(organizationId, prepared.size)
      await ObjectStorageService.putBuffer(asset.key, prepared.buffer, asset.mimeType)
      width = prepared.width
      height = prepared.height
      finalSize = prepared.size
    } else {
      const validated = await StoredFileSecurityService.validateStoredFile(
        sourceKey,
        asset.mimeType,
        Math.max(25 * 1024 * 1024, Number(intent.declaredSize || 0) + 4096),
      )
      await EntitlementService.assertStorage(organizationId, validated.size)
      if (sourceKey !== asset.key) await ObjectStorageService.putBuffer(asset.key, validated.body, asset.mimeType)
      finalSize = validated.size
    }

    let original = await ObjectStorageService.head(asset.key)
    if (Number(original.size) !== finalSize) throw new ApiError(503, 'Processed asset verification failed')

    // Legacy Phase 3 intents may still contain browser-created variants during a
    // rolling deploy. Keep them readable, but Phase 4 creates no new variants.
    const variants: any[] = []
    for (const variant of payload.variants || []) {
      if (!String(variant.key).startsWith(`${asset.key}.`) || !intent.objectKeys.includes(String(variant.key))) throw new ApiError(400, 'Invalid asset variant key')
      let meta = await ObjectStorageService.head(variant.key)
      const expectedMime = `image/${variant.format}`
      const variantMime = String(meta.contentType || '').split(';')[0].trim().toLowerCase()
      if (variantMime && variantMime !== 'application/octet-stream' && variantMime !== expectedMime) throw new ApiError(400, `Asset variant content type must be ${expectedMime}`)
      await scanStoredObject(variant.key)
      const sanitizedVariant = await StoredFileSecurityService.sanitizeStoredPublicImage(variant.key, expectedMime, {
        maxWidth: Number(variant.width) || 1280,
        maxHeight: Number(variant.width) || 1280,
        maxBytes: 20 * 1024 * 1024,
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

    original = await ObjectStorageService.head(asset.key)
    const totalSize = Number(original.size) + variants.reduce((sum: number, variant: any) => sum + Number(variant.size || 0), 0)
    const previousSize = Number(asset.size || 0)
    const storageDelta = Math.max(0, totalSize - previousSize)
    if (storageDelta) await EntitlementService.assertStorage(organizationId, storageDelta)

    asset.url = String(asset.mimeType).startsWith('image/') ? ObjectStorageService.publicImageUrl(asset.key) : ObjectStorageService.publicUrl(asset.key)
    asset.width = width
    asset.height = height
    asset.size = totalSize
    asset.etag = original.etag
    asset.scanStatus = scan.status
    asset.variants = variants
    asset.status = 'ready'
    asset.lastReferencedAt = new Date()
    await asset.save()
    const delta = totalSize - previousSize
    if (delta) await Organization.updateOne({ organizationId }, { $inc: { storageUsedBytes: delta } })
    if (sourceKey !== asset.key) await ObjectStorageService.remove(sourceKey).catch(() => undefined)
    await intent.deleteOne()
    return asset
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || error?.status || 0)
    const securityRejected = statusCode >= 400 && statusCode < 500
    if (securityRejected) {
      asset.status = 'rejected'
      asset.scanStatus = statusCode === 422 ? 'infected' : 'failed'
      await asset.save()
      const keys = Array.from(new Set([...(intent.objectKeys || []), sourceKey, String(asset.key)].filter(Boolean)))
      await Promise.allSettled(keys.map((key: string) => ObjectStorageService.remove(key)))
      await intent.deleteOne()
    }
    throw error
  }
}

export const WebsiteAssetProcessor = { finalize }
