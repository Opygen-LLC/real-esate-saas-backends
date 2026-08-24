import { createHash, randomBytes, randomUUID } from 'crypto'
import httpStatus from 'http-status'
import mongoose, { ClientSession, Types } from 'mongoose'
import dns from 'dns/promises'
import sharp, { type Metadata, type OutputInfo } from 'sharp'
import { isIP } from 'net'
import { API_ERROR_CODES } from '../../../contracts/apiContract'
import ApiError from '../../../errors/ApiError'
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
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { WebsitePage } from './websitePage.model'
import { WebsiteRevision } from './websiteRevision.model'
import { WebsiteAsset } from './websiteAsset.model'
import type { WebsiteAssetContext } from './websiteAsset.interface'
import { WebsitePreviewToken } from './websitePreviewToken.model'
import { WebsiteUploadIntent } from './websiteUploadIntent.model'
import { WebsiteBuilderValidation, checkGuardrails } from './websiteBuilder.validation'
import { TemplateRegistry } from './templateRegistry'
import { WebsiteCache } from './websiteCache'
import { ObjectStorageService } from './objectStorage.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { buildDefaultWebsiteDocument } from './defaultWebsiteDocument'
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

const PREMIUM_TEMPLATE_IDS = new Set(['template-3', 'template-4', 'template-6'])
const defaultDocument = () => buildDefaultWebsiteDocument()
const applyPublicTemplateEntitlement = (document: any, blocked: boolean) => {
  if (!blocked || !document || !PREMIUM_TEMPLATE_IDS.has(String(document?.template?.id || ''))) return document
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
  const guardrail = checkGuardrails(input)
  if (!guardrail.valid) throw new ApiError(httpStatus.BAD_REQUEST, `Document Guardrail Error: ${guardrail.message}`)
  const document = sanitizeDocument(TemplateRegistry.migrate(input))
  WebsiteBuilderValidation.builderDocumentSchema.parse(document)
  assertTemplateQuality(document)
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
    const document = sanitizeDocument(TemplateRegistry.migrate(page.draftDocument))
    WebsiteBuilderValidation.builderDocumentSchema.parse(document)
    assertTemplateQuality(document)
    await TemplateRegistry.assertEntitlement(organizationId, document)
    const latest = await WebsiteRevision.findOne({ organizationId, pageId: page._id }).sort({ version: -1 }).session(session || null).select('version').lean()
    const version = Number(latest?.version || 0) + 1
    await WebsiteRevision.create([{ organizationId, pageId: page._id, document, version, createdBy: userId, message: `Published Version v${version}` }], session ? { session } : undefined)
    page.publishedDocument = document
    page.draftDocument = document
    page.seo = document.seo || {}
    page.status = 'published'
    page.scheduledPublishAt = null
    page.publishedAt = new Date()
    page.publishedVersion = version
    if (userId) page.updatedBy = userId as any
    result = await page.save(session ? { session } : undefined)
    await Organization.updateOne({ organizationId }, { $set: { websiteStatus: 'published', 'websiteSettings.renderMode': 'builder' } }, session ? { session } : undefined)
  }
  try {
    if (session) await session.withTransaction(execute)
    else await execute()
  } finally { if (session) await session.endSession() }
  await Promise.all([WebsiteCache.del('draft', organizationId, pageId), WebsiteCache.del('published', organizationId, result.slug)])
  await DomainEventService.emit({
    organizationId,
    aggregateType: 'website',
    aggregateId: pageId,
    eventType: 'website.published',
    actorId: userId,
    payload: { summary: `Website page published: ${result.title || result.slug}`, slug: result.slug, version: result.publishedVersion },
  })
  return result
}

const publishPage = performPublish

const schedulePublish = async (organizationId: string, pageId: string, publishAt: Date, userId?: string) => {
  if (publishAt.getTime() < Date.now() + 60_000) throw new ApiError(400, 'Scheduled publish time must be at least one minute in the future')
  const page = await WebsitePage.findOneAndUpdate({ _id: pageId, organizationId }, { $set: { scheduledPublishAt: publishAt, status: 'scheduled', ...(userId ? { updatedBy: userId } : {}) } }, { new: true })
  if (!page) throw new ApiError(404, 'Website page not found')
  await WebsiteCache.del('draft', organizationId, pageId)
  return page
}

const processScheduledPublishes = async (limit = 25) => {
  // Claim due pages by moving their scheduled time forward. This keeps multiple
  // API replicas from publishing the same scheduled revision concurrently while
  // still allowing a crashed worker to be retried after the lease expires.
  let due = 0
  let published = 0
  while (due < limit) {
    const now = new Date()
    const page = await WebsitePage.findOneAndUpdate(
      { status: 'scheduled', scheduledPublishAt: { $lte: now } },
      { $set: { scheduledPublishAt: new Date(now.getTime() + 10 * 60_000) } },
      { sort: { scheduledPublishAt: 1 }, new: true },
    )
    if (!page) break
    due += 1
    try {
      await performPublish(page.organizationId, page._id.toString())
      published += 1
    } catch {
      await WebsitePage.updateOne(
        { _id: page._id, organizationId: page.organizationId, status: 'scheduled' },
        { $set: { scheduledPublishAt: new Date(Date.now() + 60_000) } },
      )
    }
  }
  return { due, published }
}

const listRevisions = async (organizationId: string, pageId: string) => WebsiteRevision.find({ organizationId, pageId }).select('-document').sort({ version: -1 }).limit(100)
const restoreRevision = async (organizationId: string, pageId: string, version: number, userId?: string) => {
  const revision = await WebsiteRevision.findOne({ organizationId, pageId, version })
  if (!revision) throw new ApiError(404, 'Website revision not found')
  const document = TemplateRegistry.migrate(revision.document)
  const page = await WebsitePage.findOneAndUpdate({ _id: pageId, organizationId }, { $set: { draftDocument: document, seo: document.seo || {}, status: 'draft', scheduledPublishAt: null, ...(userId ? { updatedBy: userId } : {}) } }, { new: true })
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
  const [page, org] = await Promise.all([WebsitePage.findById(preview.pageId).lean(), Organization.findOne({ organizationId: preview.organizationId }).lean()])
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

const assetKey = (organizationId: string, filename: string, suffix = '', options: AssetLifecycleOptions = {}) => {
  const safe = filename.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').slice(-100)
  if (options.context === 'property-draft') {
    const sessionId = assertDraftSessionId(options.uploadSessionId)
    return `tenants/${organizationId}/properties/drafts/${sessionId}/${new Date().toISOString().slice(0,10)}/${randomUUID()}${suffix}-${safe}`
  }
  return `tenants/${organizationId}/website/${new Date().toISOString().slice(0,10)}/${randomUUID()}${suffix}-${safe}`
}

const presignAsset = async (organizationId: string, payload: any, options: AssetLifecycleOptions = {}) => {
  if (!ALLOWED_ASSET_MIME_TYPES.has(payload.mimeType)) throw new ApiError(400, 'Asset file type is not allowed')
  const size = Number(payload.size)
  if (!Number.isFinite(size) || size <= 0 || size > 20 * 1024 * 1024) throw new ApiError(400, 'Invalid asset size')
  await EntitlementService.assertStorage(organizationId, size)
  const context = options.context || 'website'
  const uploadSessionId = context === 'property-draft' ? assertDraftSessionId(options.uploadSessionId) : ''
  const key = assetKey(organizationId, payload.filename, '', { context, uploadSessionId })

  // Resolve variant keys first (synchronous)
  const variantWidths = options.context === 'property-draft' ? [320, 640, 1280] : [640, 1280]
  const variantDefs = payload.mimeType.startsWith('image/')
    ? variantWidths.flatMap((width) => ['webp', 'avif'].map((format) => ({ width, format, key: `${key}.${width}.${format}` })))
    : []

  // Generate all GCS signed upload URLs in parallel (async with GCS SDK)
  const [originalUploadUrl, ...variantUploadUrls] = await Promise.all([
    ObjectStorageService.presignUpload(key, payload.mimeType).getUploadUrl(),
    ...variantDefs.map((v) => ObjectStorageService.presignUpload(v.key, `image/${v.format}`).getUploadUrl()),
  ])

  const original = { key, uploadUrl: originalUploadUrl, publicUrl: ObjectStorageService.publicUrl(key), expiresIn: config.assets.signed_url_ttl_seconds }
  const requiredVariants = variantDefs.map((v, i) => ({
    width: v.width,
    format: v.format,
    key: v.key,
    uploadUrl: variantUploadUrls[i],
    publicUrl: ObjectStorageService.publicUrl(v.key),
    expiresIn: config.assets.signed_url_ttl_seconds,
  }))

  await WebsiteUploadIntent.create({ organizationId, key, objectKeys: [key, ...variantDefs.map((v) => v.key)], declaredSize: size, mimeType: payload.mimeType, context, uploadSessionId, expiresAt: new Date(Date.now() + 60 * 60_000) })
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
    { $set: { url: ObjectStorageService.publicUrl(payload.key), originalName: String(payload.originalName || '').slice(0, 255), mimeType: payload.mimeType, width: payload.width, height: payload.height, altText: String(payload.altText || '').slice(0, 300), status: 'pending', scanStatus: 'pending', uploadedBy: userId, context: intent.context || 'website', uploadSessionId: intent.uploadSessionId || '', claimed: intent.context === 'property-draft' ? false : true, claimedByPropertyId: null, claimedAt: intent.context === 'property-draft' ? null : new Date(), lastReferencedAt: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  await OperationsQueueService.schedule({ organizationId, type: 'asset_finalize', entityId: asset._id.toString(), runAt: new Date(Date.now() + 250), payload: { variants: payload.variants || [] }, maxAttempts: 6 })
  return asset
}


const MIME_FROM_SHARP_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  heif: 'image/avif',
}

/**
 * Server-proxied upload path for property media. This is intentionally part of
 * the WebsiteAsset/WebsiteUploadIntent lifecycle so ownership checks, storage
 * accounting, malware scanning, draft cleanup and create-time claiming stay
 * identical to presigned browser uploads.
 */
const uploadAssetBuffer = async (
  organizationId: string,
  file: Express.Multer.File,
  userId?: string,
  options: AssetLifecycleOptions = {},
) => {
  const declaredMime = String(file?.mimetype || '').toLowerCase() === 'image/jpg' ? 'image/jpeg' : String(file?.mimetype || '').toLowerCase()
  if (!file?.buffer?.length) throw new ApiError(400, 'No property photo was uploaded')
  if (file.buffer.length > 20 * 1024 * 1024) throw new ApiError(413, 'Property photos must be 20 MB or smaller')

  let metadata: Metadata
  try {
    metadata = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 80_000_000 }).metadata()
  } catch {
    throw new ApiError(400, 'The uploaded file is not a valid image')
  }
  const detectedMime = metadata.format ? MIME_FROM_SHARP_FORMAT[metadata.format] : undefined
  if (!detectedMime || !ALLOWED_ASSET_MIME_TYPES.has(detectedMime)) throw new ApiError(400, 'Asset file type is not allowed')
  if (ALLOWED_ASSET_MIME_TYPES.has(declaredMime) && declaredMime !== detectedMime) throw new ApiError(400, 'Uploaded image content does not match its file type')
  const mimeType = detectedMime

  // Normalize/rotate and cap very large originals before they ever reach object
  // storage. This is intentionally done before the short Mongo claim
  // transaction used when the property itself is saved.
  let normalized: { data: Buffer; info: OutputInfo }
  try {
    let pipeline = sharp(file.buffer, { failOn: 'error', limitInputPixels: 80_000_000 })
      .rotate()
      .resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true })
    if (mimeType === 'image/jpeg') pipeline = pipeline.jpeg({ quality: 88, mozjpeg: true })
    else if (mimeType === 'image/png') pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
    else if (mimeType === 'image/webp') pipeline = pipeline.webp({ quality: 86 })
    else pipeline = pipeline.avif({ quality: 65 })
    normalized = await pipeline.toBuffer({ resolveWithObject: true })
  } catch {
    throw new ApiError(400, 'The property photo could not be normalized')
  }

  const signed: any = await presignAsset(organizationId, {
    filename: file.originalname || 'property-image',
    mimeType,
    size: normalized.data.length,
  }, options)
  const objectKeys = [signed.original.key, ...(signed.requiredVariants || []).map((variant: any) => variant.key)]

  try {
    await ObjectStorageService.putBuffer(signed.original.key, normalized.data, mimeType)

    const completedVariants: Array<{ key: string; format: 'webp' | 'avif'; width: number; height?: number }> = []
    for (const variant of signed.requiredVariants || []) {
      try {
        let pipeline = sharp(normalized.data, { failOn: 'error', limitInputPixels: 80_000_000 })
          .resize({ width: Number(variant.width), withoutEnlargement: true })
        pipeline = variant.format === 'avif' ? pipeline.avif({ quality: 62 }) : pipeline.webp({ quality: 84 })
        const rendered = await pipeline.toBuffer({ resolveWithObject: true })
        await ObjectStorageService.putBuffer(variant.key, rendered.data, `image/${variant.format}`)
        completedVariants.push({ key: variant.key, format: variant.format, width: rendered.info.width, height: rendered.info.height })
      } catch (error: any) {
        // Storage failures abort the whole draft. Codec-specific failures may
        // omit one optimization while preserving the verified normalized image.
        if (error instanceof ApiError && [API_ERROR_CODES.OBJECT_STORAGE_NOT_CONFIGURED, API_ERROR_CODES.OBJECT_STORAGE_UNAVAILABLE].includes(error.code as any)) throw error
      }
    }

    const fallbackAlt = String(file.originalname || 'Property photo').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 300)
    return await completeAsset(organizationId, {
      key: signed.original.key,
      originalName: file.originalname || 'property-image',
      mimeType,
      width: normalized.info.width,
      height: normalized.info.height,
      altText: String(options.altText || fallbackAlt).slice(0, 300),
      variants: completedVariants,
    }, userId)
  } catch (error) {
    await Promise.allSettled(objectKeys.map((key: string) => ObjectStorageService.remove(key)))
    await WebsiteUploadIntent.deleteOne({ organizationId, key: signed.original.key, status: 'pending' }).catch(() => undefined)
    throw error
  }
}


const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024
const REMOTE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

const isPrivateIp = (address: string) => {
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number)
    const [a, b] = octets
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase()
    if (value.startsWith('::ffff:')) return isPrivateIp(value.slice(7))
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')
  }
  return true
}

const assertPublicRemoteUrl = async (value: string) => {
  let url: URL
  try { url = new URL(value) } catch { throw new ApiError(400, 'Enter a valid image URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new ApiError(400, 'Remote images must use a public HTTPS URL without credentials or custom ports')
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new ApiError(400, 'Private network image URLs are not allowed')
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true }).catch(() => [])
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) throw new ApiError(400, 'Image URL must resolve to a public internet address')
  return url
}

const readRemoteImage = async (input: string) => {
  let url = await assertPublicRemoteUrl(input)
  let response: Response | null = null
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    try {
      response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { accept: 'image/avif,image/webp,image/png,image/jpeg' } })
    } catch {
      throw new ApiError(400, 'Image URL could not be downloaded')
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location || redirect === 3) throw new ApiError(400, 'Image URL has too many redirects')
      url = await assertPublicRemoteUrl(new URL(location, url).toString())
      continue
    }
    break
  }
  if (!response?.ok) throw new ApiError(400, `Image URL could not be downloaded (${response?.status || 'network error'})`)
  const mimeType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase()
  if (!REMOTE_IMAGE_TYPES.has(mimeType)) throw new ApiError(400, 'URL must point directly to a JPEG, PNG, WebP, or AVIF image')
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > MAX_REMOTE_IMAGE_BYTES) throw new ApiError(413, 'Remote image exceeds the 20 MB limit')
  const reader = response.body?.getReader()
  if (!reader) throw new ApiError(400, 'Image response has no readable body')
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_REMOTE_IMAGE_BYTES) { await reader.cancel(); throw new ApiError(413, 'Remote image exceeds the 20 MB limit') }
    chunks.push(value)
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  const validMagic = mimeType === 'image/jpeg' ? buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : mimeType === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
      : mimeType === 'image/webp' ? buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
        : buffer.subarray(4, 12).toString().startsWith('ftypavi')
  if (!validMagic) throw new ApiError(400, 'Downloaded content does not match its declared image type')
  const rawSegment = url.pathname.split('/').filter(Boolean).pop() || 'imported-image'
  let decodedName = rawSegment
  try { decodedName = decodeURIComponent(rawSegment) } catch { decodedName = rawSegment }
  const rawName = decodedName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120)
  const extension = mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.avif'
  const filename = /\.(jpe?g|png|webp|avif)$/i.test(rawName) ? rawName : `${rawName}${extension}`
  return { buffer, mimeType, filename, size: buffer.length }
}

const importAssetFromUrl = async (organizationId: string, payload: { url: string; altText?: string }, userId?: string, options: AssetLifecycleOptions = {}) => {
  const remote = await readRemoteImage(payload.url)
  return uploadAssetBuffer(
    organizationId,
    { buffer: remote.buffer, mimetype: remote.mimeType, originalname: remote.filename } as Express.Multer.File,
    userId,
    { ...options, altText: payload.altText || options.altText },
  )
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
  return { id: assetId, deleted: true, bytesReleased: size }
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
  const candidates: any[] = await WebsiteAsset.find({ context: 'property-draft', claimed: false, createdAt: { $lte: cutoff } })
    .sort({ createdAt: 1 }).limit(limit)
  const sessions = new Map<string, { organizationId: string; uploadSessionId: string }>()
  for (const asset of candidates) {
    const key = `${asset.organizationId}:${asset.uploadSessionId}`
    if (asset.uploadSessionId) sessions.set(key, { organizationId: asset.organizationId, uploadSessionId: asset.uploadSessionId })
  }

  const staleIntents: any[] = await WebsiteUploadIntent.find({ context: 'property-draft', createdAt: { $lte: cutoff } })
    .sort({ createdAt: 1 }).limit(limit)
  for (const intent of staleIntents) {
    const key = `${intent.organizationId}:${intent.uploadSessionId}`
    if (intent.uploadSessionId) sessions.set(key, { organizationId: intent.organizationId, uploadSessionId: intent.uploadSessionId })
  }

  let deleted = 0
  let reconciled = 0
  let bytesReleased = 0
  let incompleteUploadsDeleted = 0
  for (const sessionInfo of sessions.values()) {
    const result = await cleanupPropertyDraftSession(sessionInfo.organizationId, sessionInfo.uploadSessionId)
    deleted += result.deleted
    reconciled += result.reconciled
    bytesReleased += result.bytesReleased
    incompleteUploadsDeleted += result.incompleteUploadsDeleted
    await WebsiteUploadIntent.deleteMany({ organizationId: sessionInfo.organizationId, context: 'property-draft', uploadSessionId: sessionInfo.uploadSessionId, status: 'cancelled', createdAt: { $lte: cutoff } })
  }
  return { sessions: sessions.size, checked: candidates.length, deleted, reconciled, bytesReleased, incompleteUploadsDeleted, cutoff }
}

const listAssets = async (organizationId: string) => WebsiteAsset.find({ organizationId }).sort({ createdAt: -1 }).limit(200).lean()
const getAssetById = async (organizationId: string, assetId: string) => { const asset = await WebsiteAsset.findOne({ _id: assetId, organizationId }).lean(); if (!asset) throw new ApiError(404, 'Asset not found'); return asset }
const assetIsReferenced = async (organizationId: string, asset: any) => {
  const needles = [asset.key, asset.url, ...(asset.variants || []).flatMap((variant: any) => [variant.key, variant.url])].filter(Boolean).map(String)
  const [pages, properties] = await Promise.all([
    WebsitePage.find({ organizationId }).select('draftDocument publishedDocument').lean(),
    Property.find({ organizationId }).select('images mediaLinks').lean(),
  ])
  const referencesAsset = (value: unknown) => {
    const serialized = JSON.stringify(value)
    return needles.some((needle) => serialized.includes(needle))
  }
  return pages.some(referencesAsset) || properties.some(referencesAsset)
}
const deleteAsset = async (organizationId: string, assetId: string, allowReferenced = false) => {
  const asset = await WebsiteAsset.findOne({ _id: assetId, organizationId })
  if (!asset) throw new ApiError(404, 'Asset not found or unauthorized')
  if (!allowReferenced && await assetIsReferenced(organizationId, asset)) throw new ApiError(409, 'Asset is still used by a draft or published page')
  await OperationsQueueService.cancel(organizationId, 'asset_finalize', assetId)
  await Promise.allSettled([ObjectStorageService.remove(asset.key), ...(asset.variants || []).map((v) => ObjectStorageService.remove(v.key))])
  await asset.deleteOne()
  await decrementStorageUsage(organizationId, Math.max(0, asset.size || 0))
  return { id: assetId }
}

const cleanupOrphanAssets = async (limit = 100) => {
  const expiredIntents = await WebsiteUploadIntent.find({ status: 'pending', expiresAt: { $lte: new Date() } }).sort({ expiresAt: 1 }).limit(limit)
  let incompleteDeleted = 0
  for (const intent of expiredIntents) {
    const registered = await WebsiteAsset.exists({ organizationId: intent.organizationId, key: intent.key })
    if (!registered) {
      await Promise.allSettled(intent.objectKeys.map((key: string) => ObjectStorageService.remove(key)))
      incompleteDeleted += 1
    }
    await intent.deleteOne()
  }
  const candidates = await WebsiteAsset.find({ createdAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60_000) } }).sort({ createdAt: 1 }).limit(limit)
  let deleted = 0
  for (const asset of candidates) {
    const referenced = await assetIsReferenced(asset.organizationId, asset)
    if (!referenced) { await deleteAsset(asset.organizationId, asset._id.toString(), true); deleted += 1 }
    else { asset.lastReferencedAt = new Date(); await asset.save() }
  }
  return { checked: candidates.length, deleted, incompleteUploadsDeleted: incompleteDeleted }
}

const assertPublicWebsite = (org: any) => {
  if (!org || org.websiteStatus === 'provisioned' || org.websiteStatus === 'suspended') {
    throw new ApiError(404, 'Agency website not found')
  }
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
    const hot = await WebsiteCache.get<any>('published', resolution.organizationId, targetSlug)
    if (hot) return hot
  }
  const org = assertPublicWebsite(await resolveOrganization(identifier))

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
  const org = assertPublicWebsite(await resolveOrganization(identifier))
  const base = await canonicalBase(org)
  const [pages, properties] = await Promise.all([WebsitePage.find({ organizationId: org.organizationId, status: 'published' }).select('slug updatedAt').lean(), Property.find({ organizationId: org.organizationId, status: { $in: [...PUBLIC_PROPERTY_STATUSES] }, quotaLocked: { $ne: true } }).select('_id updatedAt').lean()])
  return { base, urls: [...pages.map((p: any) => ({ loc: `${base}${p.slug === '/' ? '' : p.slug}`, lastmod: p.updatedAt })), ...properties.map((p: any) => ({ loc: `${base}/properties/${p._id}`, lastmod: p.updatedAt }))] }
}

const getRobots = async (identifier: string) => { const org = assertPublicWebsite(await resolveOrganization(identifier)); const base = await canonicalBase(org); return `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n` }
const getPropertyShareCard = async (identifier: string, propertyId: string) => {
  const org = assertPublicWebsite(await resolveOrganization(identifier))
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
  }
  if (property.description) structuredData.description = String(property.description).replace(/<[^>]+>/g, '').slice(0, 500)
  if (property.price !== undefined) structuredData.offers = { '@type': 'Offer', price: property.price, priceCurrency: property.currency || 'BDT' }
  if (property.area !== undefined) structuredData.floorSize = { '@type': 'QuantitativeValue', value: property.area, unitText: property.areaUnit || 'sqft' }
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


export const WebsiteBuilderService = { getAllPages, getPageById, saveDraft, publishPage, schedulePublish, processScheduledPublishes, listRevisions, restoreRevision, createPreviewToken, getPreview, presignAsset, uploadAssetBuffer, completeAsset, importAssetFromUrl, listAssets, getAssetById, deleteAsset, validatePropertyDraftAssets, claimPropertyDraftAssets, deletePropertyDraftAsset, cleanupPropertyDraftSession, cleanupAbandonedPropertyDraftAssets, cleanupOrphanAssets, getPublicPage, getSitemap, getRobots, getPropertyShareCard, listTemplates: TemplateRegistry.list }
