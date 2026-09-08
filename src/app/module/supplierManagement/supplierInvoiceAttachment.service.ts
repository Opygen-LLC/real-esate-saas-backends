import { randomUUID } from 'crypto'
import httpStatus from 'http-status'
import mongoose from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Organization } from '../organization/organization.model'
import { ObjectStorageService } from '../websiteBuilder/objectStorage.service'
import { scanStoredObject } from '../websiteBuilder/virusScan.service'
import { MaterialPurchase } from './materialPurchase.model'
import { SupplierInvoiceAsset } from './supplierInvoiceAsset.model'

const MAX_SIZE = 10 * 1024 * 1024
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const safeFilename = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'invoice'
const actorObjectId = (value: string) => {
  if (!mongoose.isValidObjectId(value)) throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid authenticated user')
  return new mongoose.Types.ObjectId(value)
}

const present = (asset: any) => ({
  assetId: String(asset._id),
  originalName: asset.originalName,
  mimeType: asset.mimeType,
  size: Number(asset.size || asset.declaredSize || 0),
})

const presign = async (organizationId: string, purchaseId: string, actorId: string, input: { originalName: string; mimeType: string; size: number }) => {
  await TenantPurgeBarrier.assertTenantWritable(organizationId)
  if (!mongoose.isValidObjectId(purchaseId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid purchase id')
  if (!ALLOWED_MIME.has(input.mimeType)) throw new ApiError(httpStatus.BAD_REQUEST, 'Use PDF, JPG, PNG or WebP invoice attachments')
  if (!Number.isFinite(input.size) || input.size < 1 || input.size > MAX_SIZE) throw new ApiError(httpStatus.BAD_REQUEST, 'Invoice attachment must be 10 MB or smaller')
  const purchase = await MaterialPurchase.findOne({ _id: purchaseId, organizationId }).select('_id status').lean()
  if (!purchase) throw new ApiError(httpStatus.NOT_FOUND, 'Material purchase not found')
  if (purchase.status === 'Cancelled') throw new ApiError(httpStatus.CONFLICT, 'Cancelled purchases cannot receive new invoice attachments')
  if (await SupplierInvoiceAsset.exists({ organizationId, purchaseId, active: true })) throw new ApiError(httpStatus.CONFLICT, 'This purchase already has an invoice attachment. Remove it before uploading another.')
  await EntitlementService.assertStorage(organizationId, input.size)

  const assetId = new mongoose.Types.ObjectId()
  const key = `tenants/${organizationId}/suppliers/invoices/${purchaseId}/${assetId}-${randomUUID()}-${safeFilename(input.originalName)}`
  const signed = ObjectStorageService.presignUpload(key, input.mimeType)
  const uploadUrl = await signed.getUploadUrl()
  try {
    await SupplierInvoiceAsset.create({
      _id: assetId,
      organizationId,
      purchaseId,
      key,
      originalName: input.originalName,
      mimeType: input.mimeType,
      declaredSize: input.size,
      size: 0,
      status: 'pending',
      scanStatus: 'pending',
      active: true,
      uploadedBy: actorObjectId(actorId),
    })
  } catch (error: any) {
    if (error?.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'This purchase already has an invoice attachment')
    throw error
  }
  return { assetId: String(assetId), uploadUrl, expiresIn: signed.expiresIn, maxSize: MAX_SIZE }
}

const complete = async (organizationId: string, purchaseId: string, assetId: string) => {
  const asset: any = await SupplierInvoiceAsset.findOne({ _id: assetId, organizationId, purchaseId, active: true })
  if (!asset) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice attachment upload was not found')
  if (asset.status === 'ready') return present(asset)
  if (asset.status !== 'pending') throw new ApiError(httpStatus.CONFLICT, 'Invoice attachment upload is no longer active')
  try {
    const object = await ObjectStorageService.head(asset.key)
    const actualMime = String(object.contentType || '').split(';')[0].trim().toLowerCase()
    if (actualMime && actualMime !== 'application/octet-stream' && actualMime !== asset.mimeType) throw new ApiError(httpStatus.BAD_REQUEST, 'Uploaded invoice type does not match the signed upload')
    if (object.size < 1 || object.size > MAX_SIZE || object.size > Number(asset.declaredSize || 0) + 4096) throw new ApiError(httpStatus.BAD_REQUEST, 'Uploaded invoice size does not match the declared file')
    const scan = await scanStoredObject(asset.key)

    // Completing an upload must be idempotent under retries/concurrent requests.
    // Only the request that changes pending -> ready is allowed to charge storage.
    const completed: any = await SupplierInvoiceAsset.findOneAndUpdate(
      { _id: asset._id, organizationId, purchaseId, active: true, status: 'pending' },
      { $set: { size: object.size, scanStatus: scan.status, status: 'ready' } },
      { new: true },
    )
    if (completed) {
      await Organization.updateOne({ organizationId }, { $inc: { storageUsedBytes: object.size } })
      return present(completed)
    }
    const current: any = await SupplierInvoiceAsset.findOne({ _id: asset._id, organizationId, purchaseId })
    if (current?.active && current.status === 'ready') return present(current)
    throw new ApiError(httpStatus.CONFLICT, 'Invoice attachment upload is no longer active')
  } catch (error: any) {
    const rejected = await SupplierInvoiceAsset.updateOne(
      { _id: asset._id, organizationId, purchaseId, active: true, status: 'pending' },
      { $set: { status: 'rejected', active: false, ...(error instanceof ApiError && error.statusCode === 422 ? { scanStatus: 'infected' } : {}) } },
    ).catch(() => null)
    // Never delete an object that another concurrent completion already accepted.
    if (rejected?.modifiedCount) await ObjectStorageService.remove(asset.key).catch(() => undefined)
    throw error
  }
}

const download = async (organizationId: string, purchaseId: string) => {
  const asset: any = await SupplierInvoiceAsset.findOne({ organizationId, purchaseId, active: true, status: 'ready', scanStatus: { $in: ['clean', 'skipped'] } }).lean()
  if (!asset) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice attachment not found')
  return { ...present(asset), url: await ObjectStorageService.presignDownload(asset.key, 120) }
}

const remove = async (organizationId: string, purchaseId: string) => {
  const asset: any = await SupplierInvoiceAsset.findOne({ organizationId, purchaseId, active: true })
  if (!asset) return { removed: false }
  const bytes = asset.status === 'ready' ? Number(asset.size || 0) : 0
  asset.active = false
  asset.status = 'deleted'
  await asset.save()
  if (bytes > 0) await Organization.updateOne({ organizationId }, { $inc: { storageUsedBytes: -bytes } })
  await ObjectStorageService.remove(asset.key).catch(() => undefined)
  return { removed: true }
}

const attachmentsForPurchases = async (organizationId: string, purchaseIds: mongoose.Types.ObjectId[]) => {
  if (!purchaseIds.length) return new Map<string, any>()
  const rows: any[] = await SupplierInvoiceAsset.find({ organizationId, purchaseId: { $in: purchaseIds }, active: true, status: 'ready' }).select('purchaseId originalName mimeType size declaredSize').lean()
  return new Map(rows.map((row) => [String(row.purchaseId), present(row)]))
}

export const SupplierInvoiceAttachmentService = { presign, complete, download, remove, attachmentsForPurchases }
