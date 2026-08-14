import { createHash, randomBytes, randomUUID } from 'crypto'
import httpStatus from 'http-status'
import mongoose from 'mongoose'
import dns from 'dns/promises'
import { isIP } from 'net'
import ApiError from '../../../errors/ApiError'
import config from '../../../config'
import { Cache } from '../../../shared/cache'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { ALLOWED_ASSET_MIME_TYPES, assertSafeUrl, sanitizeCustomCss, sanitizeRichText } from '../../helpers/sanitize'
import { buildTenantWebsiteUrl } from '../../helpers/publicWebsiteUrl'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { DomainRecord } from '../domain/domain.model'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { WebsitePage } from './websitePage.model'
import { WebsiteRevision } from './websiteRevision.model'
import { WebsiteAsset } from './websiteAsset.model'
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

const defaultDocument = () => buildDefaultWebsiteDocument()

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
  const domain = await DomainRecord.findOne({ domain: normalized, status: 'verified', tlsStatus: 'active' }).lean()
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

const assetKey = (organizationId: string, filename: string, suffix = '') => {
  const safe = filename.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').slice(-100)
  return `tenants/${organizationId}/website/${new Date().toISOString().slice(0,10)}/${randomUUID()}${suffix}-${safe}`
}

const presignAsset = async (organizationId: string, payload: any) => {
  if (!ALLOWED_ASSET_MIME_TYPES.has(payload.mimeType)) throw new ApiError(400, 'Asset file type is not allowed')
  const size = Number(payload.size)
  if (!Number.isFinite(size) || size <= 0 || size > 20 * 1024 * 1024) throw new ApiError(400, 'Invalid asset size')
  await EntitlementService.assertStorage(organizationId, size)
  const key = assetKey(organizationId, payload.filename)
  const original = ObjectStorageService.presignUpload(key)
  const requiredVariants = payload.mimeType.startsWith('image/') ? [640, 1280].flatMap((width) => ['webp', 'avif'].map((format) => ({ width, format, ...ObjectStorageService.presignUpload(`${key}.${width}.${format}`) }))) : []
  await WebsiteUploadIntent.create({ organizationId, key, objectKeys: [key, ...requiredVariants.map((variant) => variant.key)], declaredSize: size, mimeType: payload.mimeType, expiresAt: new Date(Date.now() + 60 * 60_000) })
  return { original, requiredVariants }
}

const completeAsset = async (organizationId: string, payload: any, userId?: string) => {
  if (!String(payload.key).startsWith(`tenants/${organizationId}/website/`)) throw new ApiError(403, 'Asset key does not belong to this tenant')
  const intent: any = await WebsiteUploadIntent.findOne({ organizationId, key: payload.key })
  if (!intent) throw new ApiError(409, 'Upload intent expired or was not created by this tenant')
  if (!ALLOWED_ASSET_MIME_TYPES.has(payload.mimeType)) throw new ApiError(400, 'Asset file type is not allowed')
  if (intent.mimeType !== payload.mimeType) throw new ApiError(400, 'Uploaded asset type does not match its signed upload intent')
  for (const variant of payload.variants || []) {
    if (!String(variant.key).startsWith(`${payload.key}.`) || !intent.objectKeys.includes(String(variant.key))) throw new ApiError(400, 'Asset variant was not included in the signed upload intent')
  }
  const asset: any = await WebsiteAsset.findOneAndUpdate(
    { organizationId, key: payload.key },
    { $set: { url: ObjectStorageService.publicUrl(payload.key), originalName: String(payload.originalName || '').slice(0, 255), mimeType: payload.mimeType, width: payload.width, height: payload.height, altText: String(payload.altText || '').slice(0, 300), status: 'pending', scanStatus: 'pending', uploadedBy: userId, lastReferencedAt: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  await OperationsQueueService.schedule({ organizationId, type: 'asset_finalize', entityId: asset._id.toString(), runAt: new Date(Date.now() + 250), payload: { variants: payload.variants || [] }, maxAttempts: 6 })
  return asset
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

const importAssetFromUrl = async (organizationId: string, payload: { url: string; altText?: string }, userId?: string) => {
  const remote = await readRemoteImage(payload.url)
  await EntitlementService.assertStorage(organizationId, remote.size)
  const signed: any = await presignAsset(organizationId, { filename: remote.filename, mimeType: remote.mimeType, size: remote.size })
  const upload = await fetch(signed.original.uploadUrl, { method: 'PUT', headers: { 'content-type': remote.mimeType }, body: remote.buffer })
  if (!upload.ok) throw new ApiError(502, 'Imported image could not be saved to object storage')
  return completeAsset(organizationId, { key: signed.original.key, originalName: remote.filename, mimeType: remote.mimeType, altText: payload.altText || '', variants: [] }, userId)
}


const listAssets = async (organizationId: string) => WebsiteAsset.find({ organizationId }).sort({ createdAt: -1 }).limit(200).lean()
const assetIsReferenced = async (organizationId: string, asset: any) => {
  const needles = [asset.key, asset.url, ...(asset.variants || []).flatMap((variant: any) => [variant.key, variant.url])].filter(Boolean).map(String)
  const [pages, properties] = await Promise.all([
    WebsitePage.find({ organizationId }).select('draftDocument publishedDocument').lean(),
    Property.find({ organizationId }).select('images videos').lean(),
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
  await Organization.updateOne({ organizationId }, { $inc: { storageUsedBytes: -Math.max(0, asset.size || 0) } })
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
  const verified = org.domain ? await DomainRecord.findOne({ organizationId: org.organizationId, domain: org.domain, status: 'verified', tlsStatus: 'active' }).lean() : null
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
  const result = { organization: { organizationId: org.organizationId, agencyName: org.agencyName, logo: org.logo, primaryColor: org.primaryColor, secondaryColor: org.secondaryColor, sub_domain: org.sub_domain, domain: org.domain }, page: page ? { title: page.title, slug: page.slug, publishedDocument: page.publishedDocument, seo: { ...(page.seo || {}), canonicalUrl: page.seo?.canonicalUrl || `${base}${targetSlug === '/' ? '' : targetSlug}` } } : null }
  await WebsiteCache.set('published', org.organizationId, targetSlug, result, 300)
  return result
}

const getSitemap = async (identifier: string) => {
  const org = assertPublicWebsite(await resolveOrganization(identifier))
  const base = await canonicalBase(org)
  const [pages, properties] = await Promise.all([WebsitePage.find({ organizationId: org.organizationId, status: 'published' }).select('slug updatedAt').lean(), Property.find({ organizationId: org.organizationId, status: 'Available', moderationStatus: 'approved' }).select('_id updatedAt').lean()])
  return { base, urls: [...pages.map((p: any) => ({ loc: `${base}${p.slug === '/' ? '' : p.slug}`, lastmod: p.updatedAt })), ...properties.map((p: any) => ({ loc: `${base}/properties/${p._id}`, lastmod: p.updatedAt }))] }
}

const getRobots = async (identifier: string) => { const org = assertPublicWebsite(await resolveOrganization(identifier)); const base = await canonicalBase(org); return `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n` }
const getPropertyShareCard = async (identifier: string, propertyId: string) => { const org = assertPublicWebsite(await resolveOrganization(identifier)); const property: any = await Property.findOne({ _id: propertyId, organizationId: org.organizationId, status: 'Available', moderationStatus: 'approved' }).lean(); if (!property) throw new ApiError(404, 'Property not found'); const base = await canonicalBase(org); return { title: `${property.title} | ${org.agencyName}`, description: String(property.description || `${property.bedrooms || ''} bed property in ${property.city || 'Bangladesh'}`).replace(/<[^>]+>/g, '').slice(0, 180), image: property.images?.[0]?.url || org.logo || '', url: `${base}/properties/${property._id}`, type: 'website', structuredData: { '@context': 'https://schema.org', '@type': 'RealEstateListing', name: property.title, url: `${base}/properties/${property._id}`, image: property.images?.map((i: any) => i.url).filter(Boolean) || [], offers: { '@type': 'Offer', price: property.price, priceCurrency: property.currency || 'BDT' } } } }

export const WebsiteBuilderService = { getAllPages, getPageById, saveDraft, publishPage, schedulePublish, processScheduledPublishes, listRevisions, restoreRevision, createPreviewToken, getPreview, presignAsset, completeAsset, importAssetFromUrl, listAssets, deleteAsset, cleanupOrphanAssets, getPublicPage, getSitemap, getRobots, getPropertyShareCard, listTemplates: TemplateRegistry.list }
