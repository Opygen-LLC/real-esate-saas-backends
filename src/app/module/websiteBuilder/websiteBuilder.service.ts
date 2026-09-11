import { STUDIO_DEFAULT_PHOTOS } from '../../../contracts/websiteCatalog/photos'
import { API_ERROR_CODES } from '../../../contracts/apiContract'
import { WebsiteAssetUsageService } from './websiteAssetUsage.service'
import { requiredTransaction } from '../../db/requiredTransaction'
import { OperationsJob } from '../operationsQueue/operationsJob.model'
import { createHash, randomBytes, randomUUID } from 'crypto'
import httpStatus from 'http-status'
import mongoose, { ClientSession, Types } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { readRemoteImage } from '../../helpers/remoteImage'
import config from '../../../config'
import { Cache } from '../../../shared/cache'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { ALLOWED_ASSET_MIME_TYPES, assertSafeUrl, sanitizeCustomCss, sanitizeRichText } from '../../helpers/sanitize'
import { buildTenantWebsiteUrl } from '../../helpers/publicWebsiteUrl'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { PUBLIC_PROPERTY_STATUSES } from '../property/property.constants'
import { toPublicProperty } from '../property/publicProperty.serializer'
import { DomainRecord } from '../domain/domain.model'
import { WebsitePage } from './websitePage.model'
import { WebsiteRevision } from './websiteRevision.model'
import { WebsiteAsset } from './websiteAsset.model'
import type { WebsiteAssetContext } from './websiteAsset.interface'
import { WebsitePreviewToken } from './websitePreviewToken.model'
import { WebsiteUploadIntent } from './websiteUploadIntent.model'
import { WebsiteBuilderValidation, checkGuardrails } from './websiteBuilder.validation'
import { TemplateRegistry } from './templateRegistry'
import { ComponentRegistry } from './componentRegistry'
import { AnimationRegistry } from './animationRegistry'
import { WebsiteDesignService } from './websiteDesign.service'
import { WebsiteCache } from './websiteCache'
import { WebsitePublicationService } from './websitePublication.service'
import { ObjectStorageService } from './objectStorage.service'
import { StoredFileSecurityService } from './storedFileSecurity.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'
import { UsageBudgetService } from '../../security/usageBudget.service'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { TenantAccessService } from '../tenantAccess/tenantAccess.service'
import { buildDefaultWebsiteDocument } from './defaultWebsiteDocument'
import { assertImageUploadFilename, assertImageUploadSize } from '../../helpers/imageUploadPolicy'
import { assertTemplateQuality } from './templateQa'

const sanitizeDocument = (value: any, key = ''): any => {
  if (typeof value === 'string') {
    if (/customcss|css/i.test(key)) return sanitizeCustomCss(value)
    if (/html|richtext|description|content/i.test(key)) return sanitizeRichText(value)
    if (/url|href|src|image/i.test(key) && value) return value.startsWith('/') ? value.slice(0, 2048) : assertSafeUrl(value)
    return value.slice(0, 20000)
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeDocument(item, key))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitizeDocument(child, childKey)]))
  return value
}

const prepareBuilderDocument = (input: any) => {
  let document: any
  try {
    // Migrate first so legacy revisions are normalized before current guardrails,
    // schema validation and sanitization are applied.
    document = sanitizeDocument(TemplateRegistry.migrate(input))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Website document contains unsafe content'
    throw new ApiError(httpStatus.BAD_REQUEST, message)
  }
  const guardrail = checkGuardrails(document)
  if (!guardrail.valid) throw new ApiError(httpStatus.BAD_REQUEST, `Document Guardrail Error: ${guardrail.message}`)
  WebsiteBuilderValidation.builderDocumentSchema.parse(document)
  TemplateRegistry.assertCapabilities(document)
  assertTemplateQuality(document)
  return document
}

const defaultDocument = () => buildDefaultWebsiteDocument()
const applyPublicTemplateEntitlement = (document: any, blocked: boolean) => {
  if (!blocked || !document || !TemplateRegistry.isPremium(String(document?.template?.id || ''))) return document
  return { ...document, template: { ...(document.template || {}), id: 'template-1', version: '2.0.0' }, entitlementFallback: { reason: 'premium_template_not_in_plan', configuredTemplateId: document?.template?.id || '' } }
}

const normalizeIdentifier = (identifier: string) => identifier.toLowerCase().replace(/^www\./, '').split(':')[0]

const cacheOrganizationResolution = async (identifier: string, org: any) => {
  const identifiers = [identifier, org.organizationId, org.sub_domain, org.domain, org.customDomain].filter(Boolean).map(String)
  await Promise.all(identifiers.map((value) => Cache.tenantResolve.set(normalizeIdentifier(value), org.organizationId, 300)))
}

const resolveOrganization = async (identifier: string) => {
  const normalized = normalizeIdentifier(identifier)
  const resolution = await Cache.tenantResolve.get(normalized)
  if (resolution?.organizationId) {
    const cachedOrg = await Organization.findOne({ organizationId: resolution.organizationId })
    if (cachedOrg) return cachedOrg
    await Cache.tenantResolve.del(normalized)
  }
  const direct = await Organization.findOne({ $or: [{ organizationId: identifier }, { sub_domain: normalized }] })
  if (direct) {
    await cacheOrganizationResolution(normalized, direct)
    return direct
  }
  const domain = await DomainRecord.findOne({ domain: normalized, entitlementStatus: { $ne: 'suspended' }, status: 'verified', tlsStatus: 'active' }).lean()
  if (!domain) return null
  const org = await Organization.findOne({ organizationId: domain.organizationId })
  if (org) await cacheOrganizationResolution(normalized, org)
  return org
}

const getAllPages = async (organizationId: string) => {
  let pages = await WebsitePage.find({ organizationId }).sort({ createdAt: 1 })
  if (!pages.length) pages = [await WebsitePage.create({ organizationId, slug: '/', title: 'Home', status: 'draft', draftDocument: defaultDocument() })]
  return pages
}

const getPageById = async (organizationId: string, pageId: string) => {
  const cached = await WebsiteCache.get<any>('draft', organizationId, pageId)
  if (cached) return cached
  const page = await WebsitePage.findOne({ _id: pageId, organizationId })
  if (!page) throw new ApiError(httpStatus.NOT_FOUND, 'Website page not found')
  await WebsiteCache.set('draft', organizationId, pageId, page.toJSON(), 120)
  return page
}

const saveDraft = async (organizationId: string, pageId: string, input: any, userId?: string) => {
  const document = prepareBuilderDocument(input)
  await TemplateRegistry.assertEntitlement(organizationId, document)
  const page = await WebsitePage.findOneAndUpdate({ _id: pageId, organizationId }, { $set: { draftDocument: document, seo: document.seo || {}, status: 'draft', scheduledPublishAt: null, ...(userId ? { updatedBy: userId } : {}) } }, { new: true })
  if (!page) throw new ApiError(404, 'Website page not found')
  await WebsiteCache.del('draft', organizationId, pageId)
  return page
}

const performPublish = async (organizationId: string, pageId: string, userId?: string) => {
  const canTransact = await mongoSupportsTransactions()
  if (config.isProduction && !canTransact) throw new ApiError(503, 'Atomic website publishing requires MongoDB replica set or mongos in production')
  const session = canTransact ? await mongoose.startSession() : null
  let result: any
  const execute = async () => {
    const page = await WebsitePage.findOne({ _id: pageId, organizationId }).session(session || null)
    if (!page) throw new ApiError(404, 'Website page not found')
    const document = prepareBuilderDocument(page.draftDocument)
    await TemplateRegistry.assertEntitlement(organizationId, document)
    const latest = await WebsiteRevision.findOne({ organizationId, pageId: page._id }).sort({ version: -1 }).session(session || null).select('version').lean()
    const version = Number(latest?.version || 0) + 1
    await WebsiteRevision.create([{ organizationId, pageId: page._id, document, schemaVersion: Number(document.schemaVersion || 2), version, createdBy: userId, message: `Published Version v${version}` }], session ? { session } : undefined)
    page.publishedDocument = document
    page.draftDocument = document
    page.seo = document.seo || {}
    page.status = 'published'
    page.scheduledPublishAt = null
    page.publishedAt = new Date()
    page.publishedVersion = version
    if (userId) page.updatedBy = userId as any
    result = await page.save(session ? { session } : undefined)
    const publication = await WebsitePublicationService.commitPublicationState({ organizationId, renderMode: 'builder', session })
    result.$locals.publicationRevision = publication.publicationRevision
  }
  try {
    if (session) await session.withTransaction(execute)
    else await execute()
  } finally { if (session) await session.endSession() }
  await WebsitePublicationService.afterPublication({
    organizationId,
    renderMode: 'builder',
    aggregateId: pageId,
    actorId: userId,
    slug: result.slug,
    builderVersion: result.publishedVersion,
    publicationRevision: Number(result.$locals?.publicationRevision || 0),
  })
  return result
}

const publishPage = performPublish

const schedulePublish = async (organizationId: string, pageId: string, publishAt: Date, userId?: string) => {
  if (publishAt.getTime() < Date.now() + 60_000) throw new ApiError(400, 'Scheduled publish time must be at least one minute in the future')
  const page = await WebsitePage.findOneAndUpdate(
    { _id: pageId, organizationId },
    {
      $set: { scheduledPublishAt: publishAt, status: 'scheduled', ...(userId ? { updatedBy: userId } : {}) },
      $unset: { accessDeferredAt: 1 },
    },
    { new: true },
  )
  if (!page) throw new ApiError(404, 'Website page not found')
  await WebsiteCache.del('draft', organizationId, pageId)
  return page
}

const processScheduledPublishes = async (limit = 25) => {
  // Access-deferred pages keep their original scheduledPublishAt. Recovery only
  // clears accessDeferredAt, so overdue pages resume on the next worker tick and
  // future pages never publish early because a tenant renewed.
  let due = 0
  let published = 0
  let deferred = 0
  while (due < limit) {
    const now = new Date()
    const candidate: any = await WebsitePage.findOne({
      status: 'scheduled',
      accessDeferredAt: null,
      scheduledPublishAt: { $lte: now },
    }).sort({ scheduledPublishAt: 1, _id: 1 })
    if (!candidate) break
    due += 1

    const access = await TenantAccessService.evaluate(String(candidate.organizationId), {
      actorId: 'system:scheduled-publish',
    })
    if (!access.backgroundBusinessWorkAllowed) {
      await WebsitePage.updateOne(
        { _id: candidate._id, organizationId: candidate.organizationId, status: 'scheduled', accessDeferredAt: null },
        { $set: { accessDeferredAt: now } },
      )
      deferred += 1
      continue
    }

    const originalScheduledPublishAt = candidate.scheduledPublishAt
    const claimed: any = await WebsitePage.findOneAndUpdate(
      {
        _id: candidate._id,
        organizationId: candidate.organizationId,
        status: 'scheduled',
        accessDeferredAt: null,
        scheduledPublishAt: originalScheduledPublishAt,
      },
      { $set: { scheduledPublishAt: new Date(now.getTime() + 10 * 60_000) } },
      { new: true },
    )
    if (!claimed) continue

    try {
      await performPublish(String(claimed.organizationId), claimed._id.toString())
      published += 1
    } catch {
      await WebsitePage.updateOne(
        { _id: claimed._id, organizationId: claimed.organizationId, status: 'scheduled' },
        { $set: { scheduledPublishAt: new Date(Date.now() + 60_000) } },
      )
    }
  }
  return { due, published, deferred }
}

const listRevisions = async (organizationId: string, pageId: string) => WebsiteRevision.find({ organizationId, pageId }).select('-document').sort({ version: -1 }).limit(100)
const restoreRevision = async (organizationId: string, pageId: string, version: number, userId?: string) => {
  const revision = await WebsiteRevision.findOne({ organizationId, pageId, version }).lean()
  if (!revision) throw new ApiError(404, 'Website revision not found')
  const document = prepareBuilderDocument(revision.document)
  await TemplateRegistry.assertEntitlement(organizationId, document)
  const page = await WebsitePage.findOneAndUpdate(
    { _id: pageId, organizationId },
    {
      $set: {
        draftDocument: document,
        seo: document.seo || {},
        status: 'draft',
        scheduledPublishAt: null,
        ...(userId ? { updatedBy: userId } : {}),
      },
    },
    { new: true },
  )
  if (!page) throw new ApiError(404, 'Website page not found')
  await WebsiteCache.del('draft', organizationId, pageId)
  return page
}

const createPreviewToken = async (organizationId: string, pageId: string, userId?: string) => {
  const page = await WebsitePage.findOne({ _id: pageId, organizationId }).select('_id')
  if (!page) throw new ApiError(404, 'Website page not found')
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + 30 * 60_000)
  await WebsitePreviewToken.create({ organizationId, pageId: page._id, tokenHash, expiresAt, createdBy: userId })
  return { token, expiresAt }
}

const getPreview = async (token: string) => {
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const preview = await WebsitePreviewToken.findOne({ tokenHash, expiresAt: { $gt: new Date() } }).lean()
  if (!preview) throw new ApiError(404, 'Preview token is invalid or expired')
  const [page, org] = await Promise.all([WebsitePage.findOne({ _id: preview.pageId, organizationId: preview.organizationId }).lean(), Organization.findOne({ organizationId: preview.organizationId }).lean()])
  if (!page || !org) throw new ApiError(404, 'Preview site not found')
  return { organization: { organizationId: org.organizationId, agencyName: org.agencyName, logo: org.logo, primaryColor: org.primaryColor, secondaryColor: org.secondaryColor, sub_domain: org.sub_domain }, page: { title: page.title, slug: page.slug, draftDocument: page.draftDocument, seo: page.seo }, expiresAt: preview.expiresAt }
}

type AssetLifecycleOptions = { context?: Extract<WebsiteAssetContext, 'website' | 'property-draft'>; uploadSessionId?: string; altText?: string }

const assertDraftSessionId = (value?: string) => {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, 'A valid property draft upload session is required')
  }
  return value
}

const touchPropertyDraftSession = async (
  organizationId: string,
  uploadSessionId: string,
  session?: ClientSession | null,
) => {
  assertDraftSessionId(uploadSessionId)
  const touchedAt = new Date()
  const options = session ? { session } : undefined
  const [assets, intents] = await Promise.all([
    WebsiteAsset.updateMany(
      { organizationId, context: 'property-draft', uploadSessionId, claimed: false },
      { $set: { lastReferencedAt: touchedAt } },
      options,
    ),
    WebsiteUploadIntent.updateMany(
      { organizationId, context: 'property-draft', uploadSessionId, status: { $in: ['pending', 'completed'] } },
      { $set: { lastReferencedAt: touchedAt } },
      options,
    ),
  ])
  return {
    touchedAt,
    assets: Number(assets.matchedCount || 0),
    intents: Number(intents.matchedCount || 0),
  }
}

const canonicalPublicAssetFilename = (filename: string, mimeType: string) => {
  if (!String(mimeType || '').startsWith('image/')) return filename
  const stem = String(filename || 'image').replace(/\.[^.]+$/, '') || 'image'
  return `${stem}.webp`
}

const assetKey = (organizationId: string, filename: string, suffix = '', options: AssetLifecycleOptions = {}) => {
  const safe = filename.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').slice(-100)
  if (options.context === 'property-draft') {
    const sessionId = assertDraftSessionId(options.uploadSessionId)
    return `tenants/${organizationId}/properties/drafts/${sessionId}/${new Date().toISOString().slice(0,10)}/${randomUUID()}${suffix}-${safe}`
  }
  return `tenants/${organizationId}/website/${new Date().toISOString().slice(0,10)}/${randomUUID()}${suffix}-${safe}`
}

const assetStagingKey = (organizationId: string, filename: string) => {
  const safe = filename.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').slice(-100) || 'asset'
  return `tenants/${organizationId}/upload-staging/website/${new Date().toISOString().slice(0,10)}/${randomUUID()}-${safe}`
}

const presignAsset = async (organizationId: string, payload: any, options: AssetLifecycleOptions = {}) => {
  await TenantPurgeBarrier.assertTenantWritable(organizationId)
  if (!ALLOWED_ASSET_MIME_TYPES.has(payload.mimeType)) throw new ApiError(400, 'Asset file type is not allowed')
  const context = options.context || 'website'
  const imageContext = context === 'property-draft' ? 'property' : 'website'
  let size: number
  if (String(payload.mimeType || '').startsWith('image/')) {
    const normalized = assertImageUploadFilename(payload.filename, payload.mimeType)
    payload = { ...payload, filename: normalized.filename, mimeType: normalized.mimeType }
    size = assertImageUploadSize(payload.size, imageContext)
  } else {
    StoredFileSecurityService.assertSafeUploadFilename(payload.filename, payload.mimeType)
    size = Number(payload.size)
    if (!Number.isSafeInteger(size) || size < 1 || size > 5 * 1024 * 1024) throw new ApiError(400, 'Invalid asset size')
  }
  const uploadSessionId = context === 'property-draft' ? assertDraftSessionId(options.uploadSessionId) : ''
  const refreshKey = String(payload.key || '').trim()

  // Refresh an existing pending intent instead of reserving storage again or
  // creating orphaned upload intents when an R2 signature expires mid-upload.
  if (refreshKey) {
    if (!refreshKey.startsWith(`tenants/${organizationId}/`)) {
      throw new ApiError(403, 'Asset key does not belong to this tenant', '', API_ERROR_CODES.UPLOAD_KEY_FORBIDDEN)
    }
    const intent: any = await WebsiteUploadIntent.findOne({
      organizationId,
      key: refreshKey,
      context,
      ...(context === 'property-draft' ? { uploadSessionId } : {}),
    })
    if (!intent) throw new ApiError(409, 'Upload intent was not found', '', API_ERROR_CODES.UPLOAD_INTENT_NOT_FOUND)
    if (intent.status !== 'pending') throw new ApiError(409, 'Upload intent is no longer pending', '', API_ERROR_CODES.UPLOAD_INTENT_NOT_PENDING)
    if (intent.expiresAt && new Date(intent.expiresAt).getTime() <= Date.now()) {
      throw new ApiError(410, 'Upload intent has expired', '', API_ERROR_CODES.UPLOAD_INTENT_EXPIRED)
    }
    if (String(intent.mimeType) !== payload.mimeType || Number(intent.declaredSize) !== size) {
      throw new ApiError(409, 'Upload metadata does not match the existing upload intent', '', API_ERROR_CODES.UPLOAD_INTENT_MISMATCH)
    }
    const uploadKey = String(intent.uploadKey || '').trim()
    if (!uploadKey || !uploadKey.startsWith(`tenants/${organizationId}/upload-staging/`)) {
      throw new ApiError(409, 'Upload staging key is invalid', '', API_ERROR_CODES.UPLOAD_INTENT_MISMATCH)
    }
    intent.lastReferencedAt = new Date()
    intent.expiresAt = new Date(Date.now() + 60 * 60_000)
    await intent.save()
    const signed = ObjectStorageService.presignUpload(uploadKey, payload.mimeType)
    if (context === 'property-draft') await touchPropertyDraftSession(organizationId, uploadSessionId)
    return {
      original: {
        key: refreshKey,
        uploadUrl: await signed.getUploadUrl(),
        publicUrl: payload.mimeType.startsWith('image/') ? ObjectStorageService.publicImageUrl(refreshKey) : ObjectStorageService.publicUrl(refreshKey),
        expiresIn: signed.expiresIn,
        contentType: payload.mimeType,
      },
      requiredVariants: [],
      refreshed: true,
    }
  }

  await EntitlementService.assertStorage(organizationId, size)
  await UsageBudgetService.reserveUploadBytes(organizationId, size)
  const key = assetKey(organizationId, canonicalPublicAssetFilename(payload.filename, payload.mimeType), '', { context, uploadSessionId })
  const uploadKey = assetStagingKey(organizationId, payload.filename)
  const signed = ObjectStorageService.presignUpload(uploadKey, payload.mimeType)
  const original = {
    key,
    uploadUrl: await signed.getUploadUrl(),
    publicUrl: payload.mimeType.startsWith('image/') ? ObjectStorageService.publicImageUrl(key) : ObjectStorageService.publicUrl(key),
    expiresIn: signed.expiresIn,
    contentType: payload.mimeType,
  }

  // One canonical optimized WebP is stored after background verification.
  // Responsive sizes/formats are generated at Cloudflare's edge rather than
  // uploaded and stored as duplicate variants.
  const requiredVariants: any[] = []
  await WebsiteUploadIntent.create({
    organizationId,
    key,
    uploadKey,
    objectKeys: [uploadKey, key],
    declaredSize: size,
    mimeType: payload.mimeType,
    context,
    uploadSessionId,
    lastReferencedAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60_000),
  })
  if (context === 'property-draft') await touchPropertyDraftSession(organizationId, uploadSessionId)
  return { original, requiredVariants }
}

const completeAsset = async (organizationId: string, payload: any, userId?: string) => {
  if (!String(payload.key).startsWith(`tenants/${organizationId}/`)) throw new ApiError(403, 'Asset key does not belong to this tenant')
  const intent: any = await WebsiteUploadIntent.findOne({ organizationId, key: payload.key })
  if (!intent) throw new ApiError(409, 'Upload intent expired or was not created by this tenant')
  if (intent.status !== 'pending') {
    await Promise.allSettled((intent.objectKeys || []).map((key: string) => ObjectStorageService.remove(key)))
    throw new ApiError(409, 'Upload session was cancelled before the asset was completed')
  }
  if (!ALLOWED_ASSET_MIME_TYPES.has(payload.mimeType)) throw new ApiError(400, 'Asset file type is not allowed')
  if (intent.mimeType !== payload.mimeType) throw new ApiError(400, 'Uploaded asset type does not match its signed upload intent')
  for (const variant of payload.variants || []) {
    if (!String(variant.key).startsWith(`${payload.key}.`) || !intent.objectKeys.includes(String(variant.key))) throw new ApiError(400, 'Asset variant was not included in the signed upload intent')
  }
  const asset: any = await WebsiteAsset.findOneAndUpdate(
    { organizationId, key: payload.key },
    { $set: { url: payload.mimeType.startsWith('image/') ? ObjectStorageService.publicImageUrl(payload.key) : ObjectStorageService.publicUrl(payload.key), originalName: String(payload.originalName || '').slice(0, 255), mimeType: payload.mimeType, width: payload.width, height: payload.height, altText: String(payload.altText || '').slice(0, 300), status: 'pending', scanStatus: 'pending', failureCode: '', failureMessage: '', uploadedBy: userId, context: intent.context || 'website', uploadSessionId: intent.uploadSessionId || '', claimed: intent.context === 'property-draft' ? false : true, claimedByPropertyId: null, claimedAt: intent.context === 'property-draft' ? null : new Date(), lastReferencedAt: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  await OperationsQueueService.schedule({ organizationId, type: 'asset_finalize', entityId: asset._id.toString(), runAt: new Date(Date.now() + 250), payload: { variants: payload.variants || [] }, maxAttempts: 6 })
  if (intent.context === 'property-draft' && intent.uploadSessionId) {
    await touchPropertyDraftSession(organizationId, String(intent.uploadSessionId))
  }
  return asset
}


/**
 * Server fallback for property/website media. Bytes are written to the same
 * private staging bucket as direct browser uploads and are normalized by the
 * asynchronous asset worker. No Sharp decode/re-encode runs in this request.
 */
const uploadAssetBuffer = async (
  organizationId: string,
  file: Express.Multer.File,
  userId?: string,
  options: AssetLifecycleOptions = {},
) => {
  let mimeType = String(file?.mimetype || '').toLowerCase() === 'image/jpg' ? 'image/jpeg' : String(file?.mimetype || '').toLowerCase()
  const context = options.context || 'website'
  const imageContext = context === 'property-draft' ? 'property' : 'website'
  if (!file?.buffer?.length) throw new ApiError(400, 'No image was uploaded.', '', 'EMPTY_IMAGE', undefined, { image: ['Choose a non-empty image.'] })
  if (!ALLOWED_ASSET_MIME_TYPES.has(mimeType)) throw new ApiError(400, 'Asset file type is not allowed')
  if (mimeType.startsWith('image/')) {
    const normalized = assertImageUploadFilename(file.originalname || 'image.jpg', mimeType)
    file.originalname = normalized.filename
    mimeType = normalized.mimeType
    assertImageUploadSize(file.buffer.length, imageContext)
  } else {
    StoredFileSecurityService.assertSafeUploadFilename(file.originalname || 'asset', mimeType)
  }

  await TenantPurgeBarrier.assertTenantWritable(organizationId)
  await EntitlementService.assertStorage(organizationId, file.buffer.length)
  await UsageBudgetService.reserveUploadBytes(organizationId, file.buffer.length)
  const uploadSessionId = context === 'property-draft' ? assertDraftSessionId(options.uploadSessionId) : ''
  const originalKey = assetKey(organizationId, canonicalPublicAssetFilename(file.originalname || 'property-image', mimeType), '', { context, uploadSessionId })
  const uploadKey = assetStagingKey(organizationId, file.originalname || 'property-image')
  const objectKeys = [uploadKey, originalKey]

  await WebsiteUploadIntent.create({
    organizationId,
    key: originalKey,
    uploadKey,
    objectKeys,
    declaredSize: file.buffer.length,
    mimeType,
    context,
    uploadSessionId,
    lastReferencedAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60_000),
  })
  if (context === 'property-draft') await touchPropertyDraftSession(organizationId, uploadSessionId)

  try {
    await ObjectStorageService.putBuffer(uploadKey, file.buffer, mimeType)
    const fallbackAlt = String(file.originalname || 'Property photo').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 300)
    return await completeAsset(organizationId, {
      key: originalKey,
      originalName: file.originalname || 'property-image',
      mimeType,
      altText: String(options.altText || fallbackAlt).slice(0, 300),
      variants: [],
    }, userId)
  } catch (error) {
    await Promise.allSettled(objectKeys.map((key: string) => ObjectStorageService.remove(key)))
    await WebsiteUploadIntent.deleteOne({ organizationId, key: originalKey, status: 'pending' }).catch(() => undefined)
    throw error
  }
}


const importAssetFromUrl = async (organizationId: string, payload: { url: string; altText?: string }, userId?: string, options: AssetLifecycleOptions = {}) => {
  const remote = await readRemoteImage(payload.url)
  const asset = await uploadAssetBuffer(
    organizationId,
    { buffer: remote.buffer, mimetype: remote.mimeType, originalname: remote.filename } as Express.Multer.File,
    userId,
    { ...options, altText: payload.altText || options.altText },
  )
  const photo = STUDIO_DEFAULT_PHOTOS.find((item) => item.url === payload.url)
  const provenance = photo
    ? { provider: 'Unsplash', source: photo.source, imageUrl: photo.url, photographer: photo.photographer, photoId: photo.id, license: photo.license, importedAt: new Date() }
    : { provider: 'remote', source: payload.url, imageUrl: payload.url, importedAt: new Date() }
  // Provenance is assigned by the server, never trusted from client-supplied license claims.
  await WebsiteAsset.updateOne({ organizationId, _id: asset._id }, { $set: { provenance } })
  return asset
}


const decrementStorageUsage = async (organizationId: string, bytes: number) => {
  const amount = Math.max(0, Number(bytes || 0))
  if (!amount) return
  await Organization.collection.updateOne(
    { organizationId },
    [{ $set: { storageUsedBytes: { $max: [0, { $subtract: [{ $ifNull: ['$storageUsedBytes', 0] }, amount] }] } } }],
  )
}

const propertyReferenceForAsset = async (organizationId: string, asset: any, session?: ClientSession | null) => {
  const needles = [asset.key, asset.url, ...(asset.variants || []).flatMap((variant: any) => [variant.key, variant.url])].filter(Boolean).map(String)
  const or: Record<string, unknown>[] = [
    { 'images.assetId': String(asset._id) },
    { 'images.publicId': asset.key },
    ...needles.map((needle) => ({ 'images.url': needle })),
  ]
  const query = Property.findOne({ organizationId, $or: or }).select('_id')
  if (session) query.session(session)
  return query.lean()
}

type PropertyDraftImageRef = { assetId?: string; publicId?: string; url?: string }

const validatePropertyDraftAssets = async (
  organizationId: string,
  uploadSessionId: string,
  images: PropertyDraftImageRef[] = [],
  session?: ClientSession | null,
  existingPropertyId?: string,
) => {
  assertDraftSessionId(uploadSessionId)
  // Keep the draft heartbeat in the same Mongo transaction as validation/claiming.
  // Updating these documents outside the session after the transaction has read
  // them can cause a write-conflict/retry loop and surface as a gateway 502.
  await touchPropertyDraftSession(organizationId, uploadSessionId, session)
  if (existingPropertyId && !Types.ObjectId.isValid(existingPropertyId)) throw new ApiError(400, 'Property ID is invalid')

  const managedRefs = images.filter((image) => image.assetId || (image.publicId && image.publicId.startsWith(`tenants/${organizationId}/`)))
  if (!managedRefs.length) return []

  const assetIds = managedRefs.map((image) => image.assetId).filter((value): value is string => Boolean(value))
  if (assetIds.some((id) => !Types.ObjectId.isValid(id))) throw new ApiError(400, 'Property image reference is invalid')
  const keys = managedRefs.map((image) => image.publicId).filter((value): value is string => Boolean(value))
  const query = WebsiteAsset.find({
    organizationId,
    $or: [
      ...(assetIds.length ? [{ _id: { $in: assetIds } }] : []),
      ...(keys.length ? [{ key: { $in: keys } }] : []),
    ],
  })
  if (session) query.session(session)
  const assets: any[] = await query
  const byId = new Map(assets.map((asset: any) => [String(asset._id), asset]))
  const byKey = new Map(assets.map((asset: any) => [String(asset.key), asset]))
  const claimable: any[] = []
  const seen = new Set<string>()

  let existingAssetIds = new Set<string>()
  let existingAssetKeys = new Set<string>()
  if (existingPropertyId) {
    const propertyQuery = Property.findOne({ _id: existingPropertyId, organizationId }).select('images.assetId images.publicId')
    if (session) propertyQuery.session(session)
    const property: any = await propertyQuery.lean()
    if (!property) throw new ApiError(404, 'Property not found')
    existingAssetIds = new Set((property.images || []).map((image: any) => String(image.assetId || '')).filter(Boolean))
    existingAssetKeys = new Set((property.images || []).map((image: any) => String(image.publicId || '')).filter(Boolean))
  }

  for (const ref of managedRefs) {
    const asset: any = (ref.assetId && byId.get(String(ref.assetId))) || (ref.publicId && byKey.get(String(ref.publicId)))
    if (!asset) throw new ApiError(409, 'A property image could not be verified for this tenant')

    if (asset.status !== 'ready') throw new ApiError(409, 'All property images must finish processing before the listing can be saved')

    if (asset.context === 'property-draft') {
      if (asset.uploadSessionId !== uploadSessionId || asset.claimed) {
        throw new ApiError(409, 'A property image is not part of this draft session or has already been claimed')
      }
      const id = String(asset._id)
      if (!seen.has(id)) { claimable.push(asset); seen.add(id) }
      continue
    }

    if (existingPropertyId) {
      const alreadyOnProperty = existingAssetIds.has(String(asset._id)) || existingAssetKeys.has(String(asset.key))
      const explicitlyClaimedByProperty = asset.context === 'property' && asset.claimed === true && String(asset.claimedByPropertyId || '') === String(existingPropertyId)
      // Rolling-deploy compatibility: older edit flows stored some image assets
      // with website context. They are safe only when the exact asset is already
      // referenced by this property; a tenant cannot attach an arbitrary asset.
      if (alreadyOnProperty || explicitlyClaimedByProperty) continue
    }

    throw new ApiError(409, 'A property image is already owned by another listing or upload session')
  }

  return claimable
}

const claimPropertyDraftAssets = async (
  organizationId: string,
  uploadSessionId: string,
  propertyId: string,
  images: PropertyDraftImageRef[] = [],
  session?: ClientSession | null,
) => {
  if (!Types.ObjectId.isValid(propertyId)) throw new ApiError(400, 'Property ID is invalid')
  const assets = await validatePropertyDraftAssets(organizationId, uploadSessionId, images, session, propertyId)
  if (!assets.length) return { claimed: 0 }
  const ids = assets.map((asset: any) => asset._id)
  const update = WebsiteAsset.updateMany(
    { _id: { $in: ids }, organizationId, context: 'property-draft', uploadSessionId, claimed: false },
    { $set: { context: 'property', claimed: true, claimedByPropertyId: propertyId, claimedAt: new Date(), lastReferencedAt: new Date() } },
  )
  if (session) update.session(session)
  const result = await update
  if (result.modifiedCount !== ids.length) throw new ApiError(409, 'Property image ownership changed while the listing was being saved')
  return { claimed: result.modifiedCount }
}

const deletePropertyDraftAsset = async (organizationId: string, uploadSessionId: string, assetId: string) => {
  assertDraftSessionId(uploadSessionId)
  if (!Types.ObjectId.isValid(assetId)) throw new ApiError(400, 'Property draft asset ID is invalid')
  const asset: any = await WebsiteAsset.findOne({ _id: assetId, organizationId, context: 'property-draft', uploadSessionId, claimed: false })
  if (!asset) return { id: assetId, deleted: false }
  const property = await propertyReferenceForAsset(organizationId, asset)
  if (property) throw new ApiError(409, 'This image is already referenced by a saved property')
  await OperationsQueueService.cancel(organizationId, 'asset_finalize', assetId)
  const intent: any = await WebsiteUploadIntent.findOne({ organizationId, key: asset.key, context: 'property-draft', uploadSessionId })
  const objectKeys = Array.from(new Set([
    asset.key,
    ...(asset.variants || []).map((variant: any) => variant.key),
    ...((intent?.objectKeys || []) as string[]),
  ].filter(Boolean).map(String)))
  const removals = await Promise.allSettled(objectKeys.map((key) => ObjectStorageService.remove(key)))
  if (removals.some((result) => result.status === 'rejected')) throw new ApiError(502, 'Property draft media could not be fully removed from object storage')
  if (intent) {
    intent.status = 'cancelled'
    intent.expiresAt = new Date(Date.now() + 2 * 60 * 60_000)
    await intent.save()
  }
  const size = Math.max(0, Number(asset.size || 0))
  await asset.deleteOne()
  await decrementStorageUsage(organizationId, size)
  await touchPropertyDraftSession(organizationId, uploadSessionId)
  return { id: assetId, deleted: true, bytesReleased: size }
}

const getPropertyDraftSession = async (organizationId: string, uploadSessionId: string) => {
  assertDraftSessionId(uploadSessionId)
  const activity = await touchPropertyDraftSession(organizationId, uploadSessionId)
  const [assets, activeIntents, claimedAssets] = await Promise.all([
    WebsiteAsset.find({ organizationId, context: 'property-draft', uploadSessionId, claimed: false })
      .select('_id key url originalName mimeType status scanStatus variants altText size lastReferencedAt createdAt')
      .sort({ createdAt: 1 })
      .lean(),
    WebsiteUploadIntent.countDocuments({ organizationId, context: 'property-draft', uploadSessionId, status: { $in: ['pending', 'completed'] } }),
    WebsiteAsset.find({ organizationId, context: 'property', uploadSessionId, claimed: true, claimedByPropertyId: { $ne: null } })
      .select('claimedByPropertyId')
      .lean(),
  ])
  const claimedPropertyIds = Array.from(new Set(claimedAssets.map((asset: any) => String(asset.claimedByPropertyId || '')).filter(Boolean)))
  return {
    sessionId: uploadSessionId,
    exists: assets.length > 0 || activeIntents > 0 || claimedPropertyIds.length > 0,
    touchedAt: activity.touchedAt,
    pendingUploads: activeIntents,
    claimedPropertyId: claimedPropertyIds.length === 1 ? claimedPropertyIds[0] : undefined,
    assets,
  }
}

const cleanupPropertyDraftSession = async (organizationId: string, uploadSessionId: string) => {
  assertDraftSessionId(uploadSessionId)
  const assets: any[] = await WebsiteAsset.find({ organizationId, context: 'property-draft', uploadSessionId, claimed: false }).sort({ createdAt: 1 })
  let deleted = 0
  let reconciled = 0
  let bytesReleased = 0
  for (const asset of assets) {
    const property: any = await propertyReferenceForAsset(organizationId, asset)
    if (property?._id) {
      await WebsiteAsset.updateOne(
        { _id: asset._id, organizationId, context: 'property-draft', uploadSessionId, claimed: false },
        { $set: { context: 'property', claimed: true, claimedByPropertyId: property._id, claimedAt: new Date(), lastReferencedAt: new Date() } },
      )
      reconciled += 1
      continue
    }
    const outcome = await deletePropertyDraftAsset(organizationId, uploadSessionId, String(asset._id))
    if (outcome.deleted) { deleted += 1; bytesReleased += Number(outcome.bytesReleased || 0) }
  }

  const intents: any[] = await WebsiteUploadIntent.find({ organizationId, context: 'property-draft', uploadSessionId })
  let incompleteUploadsDeleted = 0
  for (const intent of intents) {
    const registered = await WebsiteAsset.exists({ organizationId, key: intent.key })
    if (!registered) {
      await Promise.allSettled((intent.objectKeys || []).map((key: string) => ObjectStorageService.remove(key)))
      incompleteUploadsDeleted += 1
    }
    intent.status = 'cancelled'
    intent.expiresAt = new Date(Date.now() + 2 * 60 * 60_000)
    await intent.save()
  }
  return { checked: assets.length, deleted, reconciled, bytesReleased, incompleteUploadsDeleted }
}

const cleanupAbandonedPropertyDraftAssets = async (limit = 100) => {
  const cutoff = new Date(Date.now() - config.assets.property_draft_ttl_minutes * 60_000)
  const staleActivity = {
    $or: [
      { lastReferencedAt: { $lte: cutoff } },
      { lastReferencedAt: { $exists: false }, createdAt: { $lte: cutoff } },
    ],
  }
  const candidates: any[] = await WebsiteAsset.find({ context: 'property-draft', claimed: false, ...staleActivity })
    .sort({ lastReferencedAt: 1, createdAt: 1 }).limit(limit)
  const sessions = new Map<string, { organizationId: string; uploadSessionId: string }>()
  for (const asset of candidates) {
    const key = `${asset.organizationId}:${asset.uploadSessionId}`
    if (asset.uploadSessionId) sessions.set(key, { organizationId: asset.organizationId, uploadSessionId: asset.uploadSessionId })
  }

  const staleIntents: any[] = await WebsiteUploadIntent.find({
    context: 'property-draft',
    status: { $in: ['pending', 'completed'] },
    ...staleActivity,
  }).sort({ lastReferencedAt: 1, createdAt: 1 }).limit(limit)
  for (const intent of staleIntents) {
    const key = `${intent.organizationId}:${intent.uploadSessionId}`
    if (intent.uploadSessionId) sessions.set(key, { organizationId: intent.organizationId, uploadSessionId: intent.uploadSessionId })
  }

  let deleted = 0
  let reconciled = 0
  let bytesReleased = 0
  let incompleteUploadsDeleted = 0
  let skippedActive = 0
  for (const sessionInfo of sessions.values()) {
    // A single old photo must never evict a session that has newer activity.
    // Recheck the latest activity across both assets and live intents immediately
    // before destructive cleanup so reopen/touch races resolve in favor of safety.
    const [sessionAssets, sessionIntents] = await Promise.all([
      WebsiteAsset.find({ organizationId: sessionInfo.organizationId, context: 'property-draft', uploadSessionId: sessionInfo.uploadSessionId, claimed: false })
        .select('lastReferencedAt createdAt').lean(),
      WebsiteUploadIntent.find({ organizationId: sessionInfo.organizationId, context: 'property-draft', uploadSessionId: sessionInfo.uploadSessionId, status: { $in: ['pending', 'completed'] } })
        .select('lastReferencedAt createdAt').lean(),
    ])
    const activityTimes = [...sessionAssets, ...sessionIntents]
      .map((row: any) => new Date(row.lastReferencedAt || row.createdAt || 0).getTime())
      .filter((value) => Number.isFinite(value))
    const latestActivity = activityTimes.length ? Math.max(...activityTimes) : 0
    if (latestActivity > cutoff.getTime()) { skippedActive += 1; continue }

    const result = await cleanupPropertyDraftSession(sessionInfo.organizationId, sessionInfo.uploadSessionId)
    deleted += result.deleted
    reconciled += result.reconciled
    bytesReleased += result.bytesReleased
    incompleteUploadsDeleted += result.incompleteUploadsDeleted
    // cleanupPropertyDraftSession intentionally leaves cancelled intents as
    // tombstones until their short expiresAt window passes; generic intent
    // expiry cleanup removes them later and blocks late in-flight PUTs meanwhile.
  }
  return { sessions: sessions.size, checked: candidates.length, deleted, reconciled, bytesReleased, incompleteUploadsDeleted, skippedActive, cutoff }
}

const listAssets = async (organizationId: string) => WebsiteAsset.find({ organizationId, context: { $nin: ['property', 'property-draft'] } }).sort({ createdAt: -1, _id: -1 }).limit(200).lean()
const getAssetById = async (organizationId: string, assetId: string) => {
  const asset: any = await WebsiteAsset.findOne({ _id: assetId, organizationId }).lean()
  if (!asset) throw new ApiError(404, 'Asset not found')
  if (asset.context === 'property-draft' && asset.uploadSessionId) {
    await touchPropertyDraftSession(organizationId, String(asset.uploadSessionId))
  }
  return asset
}
const assetIsReferenced = async (organizationId: string, asset: any) => (await WebsiteAssetUsageService.usageForAsset(organizationId, asset, undefined, true)).length > 0
const deleteAsset = async (organizationId: string, assetId: string, _allowReferenced = false) => {
  if (!Types.ObjectId.isValid(assetId)) throw new ApiError(400, 'Invalid asset identifier')
  return requiredTransaction(async (session) => {
    const asset = await WebsiteAsset.findOne({ _id: assetId, organizationId }).session(session)
    if (!asset) throw new ApiError(404, 'Asset not found or unauthorized')
    if ((await WebsiteAssetUsageService.usageForAsset(organizationId, asset, session, true)).length) throw new ApiError(409, 'Image is used by a live website, draft, property, or retained revision')
    await OperationsQueueService.cancel(organizationId, 'asset_finalize', assetId, { session })
    await OperationsJob.create([{ organizationId, type: 'website_asset_delete', entityId: assetId, runAt: new Date(), payload: { keys: [asset.key, ...(asset.variants || []).map((variant) => variant.key)] }, maxAttempts: 10 }], { session })
    await WebsiteAsset.deleteOne({ organizationId, _id: assetId }, { session })
    // Accounting is committed once; object cleanup is idempotent and retried by the worker.
    await Organization.collection.updateOne({ organizationId }, [{ $set: { storageUsedBytes: { $max: [0, { $subtract: [{ $ifNull: ['$storageUsedBytes', 0] }, Math.max(0, asset.size || 0)] }] } } }], { session })
    return { id: assetId }
  })
}

const cleanupOrphanAssets = async (limit = 100) => {
  const expiredIntents = await WebsiteUploadIntent.find({ status: { $in: ['pending', 'cancelled'] }, expiresAt: { $lte: new Date() } }).sort({ expiresAt: 1 }).limit(limit)
  let incompleteDeleted = 0
  for (const intent of expiredIntents) {
    const registered = await WebsiteAsset.exists({ organizationId: intent.organizationId, key: intent.key })
    if (!registered) {
      await Promise.allSettled(intent.objectKeys.map((key: string) => ObjectStorageService.remove(key)))
      incompleteDeleted += 1
    }
    await intent.deleteOne()
  }
  const candidates = await WebsiteAsset.find({ context: { $ne: 'property-draft' }, createdAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60_000) } }).sort({ createdAt: 1 }).limit(limit)
  let deleted = 0
  for (const asset of candidates) {
    const referenced = await assetIsReferenced(asset.organizationId, asset)
    if (!referenced) { await deleteAsset(asset.organizationId, asset._id.toString(), true); deleted += 1 }
    else { asset.lastReferencedAt = new Date(); await asset.save() }
  }
  return { checked: candidates.length, deleted, incompleteUploadsDeleted: incompleteDeleted }
}

const resolvePublicOrganization = async (identifier: string) => {
  const org = await resolveOrganization(identifier)
  if (!org) throw new ApiError(404, 'Agency website not found')
  await TenantAccessService.assertPublicWebsiteAccess(String(org.organizationId))
  return org
}

const canonicalBase = async (org: any) => {
  const verified = org.domain ? await DomainRecord.findOne({ organizationId: org.organizationId, domain: org.domain, entitlementStatus: { $ne: 'suspended' }, status: 'verified', tlsStatus: 'active' }).lean() : null
  return buildTenantWebsiteUrl(org.sub_domain || org.organizationId, verified?.domain)
}

const getPublicPage = async (identifier: string, slug = '/') => {
  const targetSlug = !slug || slug === 'home' ? '/' : `/${slug}`.replace(/\/+/g, '/')
  const normalized = normalizeIdentifier(identifier)
  const resolution = await Cache.tenantResolve.get(normalized)
  if (resolution?.organizationId) {
    await TenantAccessService.assertPublicWebsiteAccess(String(resolution.organizationId))
    const hot = await WebsiteCache.get<any>('published', resolution.organizationId, targetSlug)
    if (hot) return hot
  }
  const org = await resolvePublicOrganization(identifier)

  const cached = await WebsiteCache.get<any>('published', org.organizationId, targetSlug)
  if (cached) return cached
  const page = await WebsitePage.findOne({ organizationId: org.organizationId, slug: targetSlug, status: 'published', publishedDocument: { $ne: null } })
    .select('title slug publishedDocument seo updatedAt')
    .lean()
  const base = await canonicalBase(org)
  const premiumBlocked = Boolean(org.entitlementRestrictions?.premiumTemplates)
  const result = { organization: { organizationId: org.organizationId, agencyName: org.agencyName, logo: org.logo, primaryColor: org.primaryColor, secondaryColor: org.secondaryColor, sub_domain: org.sub_domain, domain: org.entitlementRestrictions?.customDomain ? '' : org.domain }, page: page ? { title: page.title, slug: page.slug, publishedDocument: applyPublicTemplateEntitlement(page.publishedDocument, premiumBlocked), seo: { ...(page.seo || {}), canonicalUrl: page.seo?.canonicalUrl || `${base}${targetSlug === '/' ? '' : targetSlug}` } } : null }
  await WebsiteCache.set('published', org.organizationId, targetSlug, result, 300)
  return result
}

const getSitemap = async (identifier: string) => {
  const org = await resolvePublicOrganization(identifier)
  const base = await canonicalBase(org)
  // Public property listings filter by status: 'Available', quotaLocked: { $ne: true }
  const [pages, properties] = await Promise.all([WebsitePage.find({ organizationId: org.organizationId, status: 'published' }).select('slug updatedAt').lean(), Property.find({ organizationId: org.organizationId, status: { $in: [...PUBLIC_PROPERTY_STATUSES] }, quotaLocked: { $ne: true } }).select('_id updatedAt').lean()])
  return { base, urls: [...pages.map((p: any) => ({ loc: `${base}${p.slug === '/' ? '' : p.slug}`, lastmod: p.updatedAt })), ...properties.map((p: any) => ({ loc: `${base}/properties/${p._id}`, lastmod: p.updatedAt }))] }
}

const getRobots = async (identifier: string) => { const org = await resolvePublicOrganization(identifier); const base = await canonicalBase(org); return `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n` }
const getPropertyShareCard = async (identifier: string, propertyId: string) => {
  const org = await resolvePublicOrganization(identifier)
  const source: any = await Property.findOne({
    _id: propertyId,
    organizationId: org.organizationId,
    status: { $in: [...PUBLIC_PROPERTY_STATUSES] },
    quotaLocked: { $ne: true },
  }).lean()
  if (!source) throw new ApiError(404, 'Property not found')

  const property: any = toPublicProperty(source)
  const base = await canonicalBase(org)
  const url = `${base}/properties/${property._id}`
  const description = String(property.description || `${property.title} from ${org.agencyName}`)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
  const structuredData: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: property.title,
    url,
    image: property.images?.map((image: any) => image.url).filter(Boolean) || [],
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Property type', value: property.propertyType },
      { '@type': 'PropertyValue', name: 'Listing type', value: property.listingType },
    ],
  }
  const addStructuredProperty = (name: string, value: unknown, unitText?: string) => {
    if (value === undefined || value === null || value === '') return
    structuredData.additionalProperty.push({ '@type': 'PropertyValue', name, value, ...(unitText ? { unitText } : {}) })
  }
  if (property.description) structuredData.description = String(property.description).replace(/<[^>]+>/g, '').slice(0, 500)
  if (property.price !== undefined) {
    structuredData.offers = { '@type': 'Offer', price: property.price, priceCurrency: property.currency || 'BDT' }
    if (property.pricing?.mode && property.pricing.mode !== 'TOTAL') {
      addStructuredProperty('Pricing mode', property.pricing.mode)
      addStructuredProperty('Unit rate', property.pricing.unitRate, property.currency || 'BDT')
    }
  }
  if (property.propertyType === 'LandPlot') {
    addStructuredProperty('Land area', property.area, property.areaUnit || 'sqft')
    addStructuredProperty('Road width', property.roadWidthFeet, 'ft')
    addStructuredProperty('Facing', property.facing)
    addStructuredProperty('Approval authority', property.regulatory?.approvalAuthority)
  } else if (property.propertyType === 'HotelResort') {
    addStructuredProperty('Total rooms', property.totalRooms)
    addStructuredProperty('Star rating', property.starRating)
    addStructuredProperty('Operating status', property.hotelOperatingStatus)
    addStructuredProperty('Land area', property.landArea, property.landAreaUnit)
    if (property.builtUpArea !== undefined) structuredData.floorSize = { '@type': 'QuantitativeValue', value: property.builtUpArea, unitText: property.builtUpAreaUnit || 'sqft' }
  } else {
    if (property.area !== undefined) structuredData.floorSize = { '@type': 'QuantitativeValue', value: property.area, unitText: property.areaUnit || 'sqft' }
    if (property.bedrooms !== undefined) structuredData.numberOfBedrooms = property.bedrooms
    if (property.bathrooms !== undefined) structuredData.numberOfBathroomsTotal = property.bathrooms
    addStructuredProperty('Floor', property.floorNumber)
  }
  if (!structuredData.additionalProperty.length) delete structuredData.additionalProperty
  if (property.address || property.city || property.state || property.country) {
    structuredData.address = {
      '@type': 'PostalAddress',
      ...(property.address ? { streetAddress: property.address } : {}),
      ...(property.city ? { addressLocality: property.city } : {}),
      ...(property.state ? { addressRegion: property.state } : {}),
      ...(property.country ? { addressCountry: property.country } : {}),
    }
  }
  return {
    title: `${property.title} | ${org.agencyName}`,
    description,
    image: property.images?.[0]?.url || org.logo || '',
    url,
    type: 'website',
    structuredData,
  }
}


export const WebsiteBuilderService = { getAllPages, getPageById, saveDraft, publishPage, schedulePublish, processScheduledPublishes, listRevisions, restoreRevision, createPreviewToken, getPreview, presignAsset, uploadAssetBuffer, completeAsset, importAssetFromUrl, listAssets, getAssetById, deleteAsset, validatePropertyDraftAssets, claimPropertyDraftAssets, deletePropertyDraftAsset, getPropertyDraftSession, touchPropertyDraftSession, cleanupPropertyDraftSession, cleanupAbandonedPropertyDraftAssets, cleanupOrphanAssets, getPublicPage, getSitemap, getRobots, getPropertyShareCard, listTemplates: TemplateRegistry.list, listComponents: ComponentRegistry.list, listAnimations: AnimationRegistry.list, getDesignRegistry: WebsiteDesignService.getDesignRegistry, getDesignState: WebsiteDesignService.getDesignState, applyDesignAction: WebsiteDesignService.applyDesignAction }
