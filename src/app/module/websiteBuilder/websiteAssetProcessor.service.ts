import ApiError from '../../../errors/ApiError'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Organization } from '../organization/organization.model'
import { ObjectStorageService } from './objectStorage.service'
import { scanStoredObject } from './virusScan.service'
import { WebsiteAsset } from './websiteAsset.model'
import { WebsiteUploadIntent } from './websiteUploadIntent.model'

const finalize = async (organizationId: string, assetId: string, payload: any) => {
  const asset: any = await WebsiteAsset.findOne({ _id: assetId, organizationId })
  if (!asset) return null
  if (asset.status === 'ready') return asset
  const intent: any = await WebsiteUploadIntent.findOne({ organizationId, key: asset.key })
  if (!intent) throw new ApiError(409, 'Upload intent expired before asset processing completed')

  try {
    const original = await ObjectStorageService.head(asset.key)
    const actualMime = original.contentType.split(';')[0].trim().toLowerCase()
    if (actualMime && actualMime !== 'application/octet-stream' && actualMime !== asset.mimeType) throw new ApiError(400, 'Uploaded object content type does not match its signed upload')
    const scan = await scanStoredObject(asset.key)
    const variants: any[] = []
    for (const variant of payload.variants || []) {
      if (!String(variant.key).startsWith(`${asset.key}.`) || !intent.objectKeys.includes(String(variant.key))) throw new ApiError(400, 'Invalid asset variant key')
      const meta = await ObjectStorageService.head(variant.key)
      const expectedMime = `image/${variant.format}`
      const variantMime = meta.contentType.split(';')[0].trim().toLowerCase()
      if (variantMime && variantMime !== 'application/octet-stream' && variantMime !== expectedMime) throw new ApiError(400, `Asset variant content type must be ${expectedMime}`)
      await scanStoredObject(variant.key)
      variants.push({ key: variant.key, url: ObjectStorageService.publicUrl(variant.key), format: variant.format, width: Number(variant.width), height: variant.height ? Number(variant.height) : undefined, size: meta.size })
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
    if (error?.statusCode === 422) {
      asset.status = 'rejected'; asset.scanStatus = 'infected'; await asset.save()
      await Promise.allSettled(intent.objectKeys.map((key: string) => ObjectStorageService.remove(key)))
      await intent.deleteOne()
    }
    throw error
  }
}

export const WebsiteAssetProcessor = { finalize }
