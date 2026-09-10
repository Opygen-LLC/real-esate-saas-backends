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

  try {
    let original = await ObjectStorageService.head(asset.key)
    const actualMime = original.contentType.split(';')[0].trim().toLowerCase()
    if (actualMime && actualMime !== 'application/octet-stream' && actualMime !== asset.mimeType) throw new ApiError(400, 'Uploaded object content type does not match its signed upload')
    await StoredFileSecurityService.validateStoredFile(asset.key, asset.mimeType, Math.max(25 * 1024 * 1024, Number(intent.declaredSize || 0) + 4096))
    const scan = await scanStoredObject(asset.key)
    if (String(asset.mimeType).startsWith('image/')) {
      await StoredFileSecurityService.sanitizeStoredPublicImage(asset.key, asset.mimeType, { maxBytes: Math.max(25 * 1024 * 1024, Number(intent.declaredSize || 0) + 4096) })
      original = await ObjectStorageService.head(asset.key)
    }
    const variants: any[] = []
    for (const variant of payload.variants || []) {
      if (!String(variant.key).startsWith(`${asset.key}.`) || !intent.objectKeys.includes(String(variant.key))) throw new ApiError(400, 'Invalid asset variant key')
      let meta = await ObjectStorageService.head(variant.key)
      const expectedMime = `image/${variant.format}`
      const variantMime = meta.contentType.split(';')[0].trim().toLowerCase()
      if (variantMime && variantMime !== 'application/octet-stream' && variantMime !== expectedMime) throw new ApiError(400, `Asset variant content type must be ${expectedMime}`)
      await StoredFileSecurityService.validateStoredFile(variant.key, expectedMime, 20 * 1024 * 1024)
      await scanStoredObject(variant.key)
      const sanitizedVariant = await StoredFileSecurityService.sanitizeStoredPublicImage(variant.key, expectedMime, { maxWidth: Number(variant.width) || 1280, maxHeight: Number(variant.width) || 1280, maxBytes: 20 * 1024 * 1024 })
      meta = await ObjectStorageService.head(variant.key)
      variants.push({ key: variant.key, url: ObjectStorageService.publicUrl(variant.key), format: variant.format, width: sanitizedVariant.width || Number(variant.width), height: sanitizedVariant.height, size: meta.size })
    }
    const totalSize = original.size + variants.reduce((sum: number, variant: any) => sum + variant.size, 0)
    const previousSize = Number(asset.size || 0)
    const storageDelta = Math.max(0, totalSize - previousSize)
    if (storageDelta) await EntitlementService.assertStorage(organizationId, storageDelta)
    asset.url = ObjectStorageService.publicUrl(asset.key)
    asset.size = totalSize
    asset.etag = original.etag
    asset.scanStatus = scan.status
    asset.variants = variants
    asset.status = 'ready'
    asset.lastReferencedAt = new Date()
    await asset.save()
    const delta = totalSize - previousSize
    if (delta) await Organization.updateOne({ organizationId }, { $inc: { storageUsedBytes: delta } })
    await intent.deleteOne()
    return asset
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || error?.status || 0)
    const securityRejected = statusCode >= 400 && statusCode < 500
    if (securityRejected) {
      asset.status = 'rejected'
      asset.scanStatus = statusCode === 422 ? 'infected' : 'failed'
      await asset.save()
      await Promise.allSettled(intent.objectKeys.map((key: string) => ObjectStorageService.remove(key)))
      await intent.deleteOne()
    }
    throw error
  }
}

export const WebsiteAssetProcessor = { finalize }
