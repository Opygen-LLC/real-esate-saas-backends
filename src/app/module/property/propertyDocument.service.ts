import { randomUUID } from 'crypto'
import httpStatus from 'http-status'
import mongoose, { type ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Organization } from '../organization/organization.model'
import { ObjectStorageService } from '../websiteBuilder/objectStorage.service'
import { scanStoredObject } from '../websiteBuilder/virusScan.service'
import { allowedDocumentTypesForProperty, type PropertyDocumentType, type PropertyType } from './property.constants'
import type { IPropertyDocument } from './property.interface'
import { PropertyDocumentAsset } from './propertyDocumentAsset.model'

const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024
const MAX_DOCUMENTS = 20
const ALLOWED_DOCUMENT_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

const assertDraftSessionId = (value?: string) => {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A valid property draft upload session is required')
  }
  return value
}

const safeFilename = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'document'

const present = (asset: any): IPropertyDocument => ({
  assetId: asset._id.toString(),
  category: asset.category,
  originalName: asset.originalName,
  mimeType: asset.mimeType,
  size: Number(asset.size || asset.declaredSize || 0),
  visibility: 'private',
})

const presign = async (organizationId: string, input: { uploadSessionId: string; category: PropertyDocumentType; originalName: string; mimeType: string; size: number }, userId?: string) => {
  await TenantPurgeBarrier.assertTenantWritable(organizationId)
  const uploadSessionId = assertDraftSessionId(input.uploadSessionId)
  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(input.mimeType)) throw new ApiError(httpStatus.BAD_REQUEST, 'Unsupported property document type')
  if (!Number.isFinite(input.size) || input.size < 1 || input.size > MAX_DOCUMENT_SIZE) throw new ApiError(httpStatus.BAD_REQUEST, 'Property document must be between 1 byte and 20 MB')
  await EntitlementService.assertStorage(organizationId, input.size)
  const currentCount = await PropertyDocumentAsset.countDocuments({ organizationId, uploadSessionId, status: { $in: ['pending', 'ready'] }, claimed: false })
  if (currentCount >= MAX_DOCUMENTS) throw new ApiError(httpStatus.BAD_REQUEST, `A property can have up to ${MAX_DOCUMENTS} private documents`)

  const assetId = new mongoose.Types.ObjectId()
  const key = `tenants/${organizationId}/properties/documents/drafts/${uploadSessionId}/${new Date().toISOString().slice(0, 10)}/${assetId.toString()}-${randomUUID()}-${safeFilename(input.originalName)}`
  const signed = ObjectStorageService.presignUpload(key, input.mimeType)
  const uploadUrl = await signed.getUploadUrl()
  await PropertyDocumentAsset.create({
    _id: assetId,
    organizationId,
    uploadSessionId,
    key,
    category: input.category,
    originalName: input.originalName,
    mimeType: input.mimeType,
    declaredSize: input.size,
    size: 0,
    status: 'pending',
    scanStatus: 'pending',
    uploadedBy: userId,
    claimed: false,
    claimedByPropertyId: null,
    lastReferencedAt: new Date(),
  })
  return { assetId: assetId.toString(), uploadUrl, expiresIn: signed.expiresIn, maxSize: MAX_DOCUMENT_SIZE }
}

const complete = async (organizationId: string, assetId: string, uploadSessionId: string) => {
  const asset: any = await PropertyDocumentAsset.findOne({ _id: assetId, organizationId, uploadSessionId: assertDraftSessionId(uploadSessionId), claimed: false })
  if (!asset) throw new ApiError(httpStatus.NOT_FOUND, 'Property document upload was not found')
  if (asset.status === 'ready') return present(asset)
  try {
    const object = await ObjectStorageService.head(asset.key)
    const actualMime = String(object.contentType || '').split(';')[0].trim().toLowerCase()
    if (actualMime && actualMime !== 'application/octet-stream' && actualMime !== asset.mimeType) throw new ApiError(httpStatus.BAD_REQUEST, 'Uploaded document type does not match the signed upload')
    if (object.size < 1 || object.size > MAX_DOCUMENT_SIZE || object.size > Number(asset.declaredSize || 0) + 4096) throw new ApiError(httpStatus.BAD_REQUEST, 'Uploaded document size does not match the declared file')
    const scan = await scanStoredObject(asset.key)
    asset.size = object.size
    asset.scanStatus = scan.status
    asset.status = 'ready'
    asset.lastReferencedAt = new Date()
    await asset.save()
    await Organization.updateOne({ organizationId }, { $inc: { storageUsedBytes: object.size } })
    return present(asset)
  } catch (error: any) {
    asset.status = 'rejected'
    if (error instanceof ApiError && error.statusCode === 422) asset.scanStatus = 'infected'
    await asset.save()
    await ObjectStorageService.remove(asset.key).catch(() => undefined)
    throw error
  }
}

const getDraftSession = async (organizationId: string, uploadSessionId: string) => {
  const sessionId = assertDraftSessionId(uploadSessionId)
  const assets: any[] = await PropertyDocumentAsset.find({ organizationId, uploadSessionId: sessionId }).select('_id status claimed claimedByPropertyId category originalName mimeType size declaredSize').lean()
  const claimedIds = [...new Set(assets.filter((item) => item.claimedByPropertyId).map((item) => String(item.claimedByPropertyId)))]
  return {
    sessionId,
    exists: assets.length > 0,
    claimedPropertyId: claimedIds.length === 1 ? claimedIds[0] : undefined,
    documents: assets.filter((item) => item.status === 'ready').map(present),
  }
}

const validateDraftDocuments = async (organizationId: string, uploadSessionId: string, documents: IPropertyDocument[], propertyType: PropertyType, session?: ClientSession | null, propertyId?: string) => {
  assertDraftSessionId(uploadSessionId)
  if (documents.length > MAX_DOCUMENTS) throw new ApiError(httpStatus.BAD_REQUEST, `A property can have up to ${MAX_DOCUMENTS} private documents`)
  const allowed = new Set<PropertyDocumentType>(allowedDocumentTypesForProperty(propertyType))
  if (documents.some((document) => !allowed.has(document.category))) throw new ApiError(httpStatus.BAD_REQUEST, `One or more document categories are not valid for ${propertyType}`)
  const assetIds = documents.map((document) => String(document.assetId))
  if (new Set(assetIds).size !== assetIds.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Property document asset IDs must be unique')
  if (!assetIds.length) return
  const query = PropertyDocumentAsset.find({ _id: { $in: assetIds }, organizationId })
  if (session) query.session(session)
  const assets: any[] = await query
  if (assets.length !== assetIds.length) throw new ApiError(httpStatus.BAD_REQUEST, 'One or more property documents do not belong to this tenant')
  for (const asset of assets) {
    const canReuseClaimed = propertyId && asset.claimed && String(asset.claimedByPropertyId || '') === propertyId
    if (!canReuseClaimed && (asset.claimed || asset.uploadSessionId !== uploadSessionId)) throw new ApiError(httpStatus.CONFLICT, 'One or more property documents belong to another property draft')
    if (asset.status !== 'ready' || !['clean', 'skipped'].includes(asset.scanStatus)) throw new ApiError(httpStatus.CONFLICT, 'All property documents must finish security scanning before publishing')
    const submitted = documents.find((document) => String(document.assetId) === String(asset._id))
    if (!submitted || submitted.category !== asset.category) throw new ApiError(httpStatus.BAD_REQUEST, 'Property document metadata does not match the uploaded asset')
  }
}


const validateClaimedDocuments = async (organizationId: string, propertyId: string, documents: IPropertyDocument[], propertyType: PropertyType) => {
  if (documents.length > MAX_DOCUMENTS) throw new ApiError(httpStatus.BAD_REQUEST, `A property can have up to ${MAX_DOCUMENTS} private documents`)
  const allowed = new Set<PropertyDocumentType>(allowedDocumentTypesForProperty(propertyType))
  if (documents.some((document) => !allowed.has(document.category))) throw new ApiError(httpStatus.BAD_REQUEST, `One or more document categories are not valid for ${propertyType}`)
  const assetIds = documents.map((document) => String(document.assetId))
  if (new Set(assetIds).size !== assetIds.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Property document asset IDs must be unique')
  if (!assetIds.length) return
  const assets: any[] = await PropertyDocumentAsset.find({ _id: { $in: assetIds }, organizationId, claimed: true, claimedByPropertyId: propertyId })
  if (assets.length !== assetIds.length) throw new ApiError(httpStatus.BAD_REQUEST, 'One or more private documents do not belong to this property')
  for (const asset of assets) {
    if (asset.status !== 'ready' || !['clean', 'skipped'].includes(asset.scanStatus)) throw new ApiError(httpStatus.CONFLICT, 'All property documents must pass security scanning')
    const submitted = documents.find((document) => String(document.assetId) === String(asset._id))
    if (!submitted || submitted.category !== asset.category) throw new ApiError(httpStatus.BAD_REQUEST, 'Property document metadata does not match the stored asset')
  }
}

const claimDraftDocuments = async (organizationId: string, uploadSessionId: string, propertyId: string, documents: IPropertyDocument[], session?: ClientSession | null) => {
  if (!documents.length) return
  const ids = documents.map((document) => document.assetId)
  await PropertyDocumentAsset.updateMany(
    { _id: { $in: ids }, organizationId, uploadSessionId, claimed: false, status: 'ready' },
    { $set: { claimed: true, claimedByPropertyId: propertyId, claimedAt: new Date(), lastReferencedAt: new Date() } },
    session ? { session } : undefined,
  )
}

const cleanupDraftSession = async (organizationId: string, uploadSessionId: string) => {
  const sessionId = assertDraftSessionId(uploadSessionId)
  const assets: any[] = await PropertyDocumentAsset.find({ organizationId, uploadSessionId: sessionId, claimed: false })
  await Promise.allSettled(assets.map((asset) => ObjectStorageService.remove(asset.key)))
  if (assets.length) await PropertyDocumentAsset.deleteMany({ _id: { $in: assets.map((asset) => asset._id) }, organizationId, claimed: false })
  return { deleted: assets.length }
}

const deleteDraftDocument = async (organizationId: string, uploadSessionId: string, assetId: string) => {
  const asset: any = await PropertyDocumentAsset.findOneAndDelete({ _id: assetId, organizationId, uploadSessionId: assertDraftSessionId(uploadSessionId), claimed: false })
  if (!asset) return { deleted: false }
  await ObjectStorageService.remove(asset.key).catch(() => undefined)
  if (asset.size > 0) await Organization.updateOne({ organizationId }, { $inc: { storageUsedBytes: -Number(asset.size) } })
  return { deleted: true }
}

const download = async (organizationId: string, assetId: string) => {
  const asset: any = await PropertyDocumentAsset.findOne({ _id: assetId, organizationId, claimed: true, status: 'ready' })
  if (!asset || !['clean', 'skipped'].includes(asset.scanStatus)) throw new ApiError(httpStatus.NOT_FOUND, 'Property document not found')
  const signed = ObjectStorageService.presignDownload(asset.key, 120)
  return { url: await signed, expiresIn: 120, name: asset.originalName, mimeType: asset.mimeType }
}

const removeUnreferencedClaimedAssets = async (organizationId: string, propertyId: string, retainedIds: string[]) => {
  const query: Record<string, any> = { organizationId, claimed: true, claimedByPropertyId: propertyId }
  if (retainedIds.length) query._id = { $nin: retainedIds }
  const assets: any[] = await PropertyDocumentAsset.find(query)
  if (!assets.length) return { deleted: 0 }
  await Promise.allSettled(assets.map((asset) => ObjectStorageService.remove(asset.key)))
  const bytes = assets.reduce((sum, asset) => sum + Number(asset.size || 0), 0)
  await PropertyDocumentAsset.deleteMany({ _id: { $in: assets.map((asset) => asset._id) }, organizationId, claimedByPropertyId: propertyId })
  if (bytes > 0) await Organization.updateOne({ organizationId }, { $inc: { storageUsedBytes: -bytes } })
  return { deleted: assets.length }
}

export const PropertyDocumentService = {
  presign,
  complete,
  getDraftSession,
  validateDraftDocuments,
  validateClaimedDocuments,
  claimDraftDocuments,
  cleanupDraftSession,
  deleteDraftDocument,
  download,
  removeUnreferencedClaimedAssets,
}
