import { createHash, randomBytes, randomUUID } from 'crypto'
import httpStatus from 'http-status'
import mongoose from 'mongoose'
import ApiError from '../../../errors/ApiError'
import config from '../../../config'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { ALLOWED_ASSET_MIME_TYPES, assertSafeUrl, sanitizeCustomCss, sanitizeRichText } from '../../helpers/sanitize'
import { Organization } from '../organization/organization.model'
import { Property } from '../property/property.model'
import { DomainRecord } from '../domain/domain.model'
import { WebsitePage } from './websitePage.model'
import { WebsiteRevision } from './websiteRevision.model'
import { WebsiteAsset } from './websiteAsset.model'
import { WebsitePreviewToken } from './websitePreviewToken.model'
import { WebsiteUploadIntent } from './websiteUploadIntent.model'
import { WebsiteBuilderValidation, checkGuardrails } from './websiteBuilder.validation'
import { TemplateRegistry } from './templateRegistry'
import { WebsiteCache } from './websiteCache'
import { ObjectStorageService } from './objectStorage.service'
import { scanStoredObject } from './virusScan.service'
import { EntitlementService } from '../entitlement/entitlement.service'
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

const defaultDocument = () => ({
  schemaVersion: 2,
  template: { id: 'template-1', version: '2.0.0' },
  seo: { canonicalUrl: '', title: '', description: '', openGraph: { title: '', description: '', image: '' }, robots: { index: true, follow: true }, structuredData: { enabled: true } },
  pages: [{ id: 'home', slug: '/', title: 'Home Page', nodes: [{ id: 'section-hero', type: 'section', label: 'Hero Section', props: { fullWidth: true }, styles: { desktop: { paddingTop: 80, paddingBottom: 80, backgroundColor: '#0f172a', textColor: '#ffffff' } }, children: [{ id: 'container-hero', type: 'container', label: 'Hero Container', props: {}, styles: { desktop: { maxWidth: 1120, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 } }, children: [{ id: 'heading-1', type: 'heading', label: 'Hero Title', props: { level: 1, text: 'Find Your Signature Residence' }, styles: { desktop: { fontSize: 52, fontWeight: '800', textColor: '#ffffff' } } }, { id: 'paragraph-1', type: 'paragraph', label: 'Hero Subtitle', props: { text: 'Discover verified homes, land and commercial property from a trusted local agency.' }, styles: { desktop: { fontSize: 16, textColor: '#94a3b8' } } }] }] }] }],
  theme: { primaryColor: '#0f172a', secondaryColor: '#2563eb', accentColor: '#7c3aed', fontFamily: 'Inter' },
})

const resolveOrganization = async (identifier: string) => {
  const direct = await Organization.findOne({ $or: [{ organizationId: identifier }, { sub_domain: identifier }] })
  if (direct) return direct
  const normalized = identifier.toLowerCase().replace(/^www\./, '').split(':')[0]
  const domain = await DomainRecord.findOne({ domain: normalized, status: 'verified', tlsStatus: 'active' }).lean()
  if (!domain) return null
  return Organization.findOne({ organizationId: domain.organizationId })
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
  }
  try {
    if (session) await session.withTransaction(execute)
    else await execute()
  } finally { if (session) await session.endSession() }
  await Promise.all([WebsiteCache.del('draft', organizationId, pageId), WebsiteCache.del('published', organizationId, result.slug)])
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
  const [original, intent, existingAsset] = await Promise.all([
    ObjectStorageService.head(payload.key),
    WebsiteUploadIntent.findOne({ organizationId, key: payload.key }),
    WebsiteAsset.findOne({ organizationId, key: payload.key }),
  ])
  if (!intent && !existingAsset) throw new ApiError(409, 'Upload intent expired or was not created by this tenant')
  if (!ALLOWED_ASSET_MIME_TYPES.has(payload.mimeType)) throw new ApiError(400, 'Asset file type is not allowed')
  if (intent && intent.mimeType !== payload.mimeType) throw new ApiError(400, 'Uploaded asset type does not match its signed upload intent')
  const actualMime = original.contentType.split(';')[0].trim().toLowerCase()
  if (actualMime && actualMime !== 'application/octet-stream' && actualMime !== payload.mimeType) throw new ApiError(400, 'Uploaded object content type does not match the signed upload')
  const scan = await scanStoredObject(payload.key)
  const variants: any[] = []
  for (const variant of payload.variants || []) {
    if (!String(variant.key).startsWith(`${payload.key}.`)) throw new ApiError(400, 'Invalid asset variant key')
    if (intent && !intent.objectKeys.includes(String(variant.key))) throw new ApiError(400, 'Asset variant was not included in the signed upload intent')
    const meta = await ObjectStorageService.head(variant.key)
    const expectedMime = `image/${variant.format}`
    const variantMime = meta.contentType.split(';')[0].trim().toLowerCase()
    if (variantMime && variantMime !== 'application/octet-stream' && variantMime !== expectedMime) throw new ApiError(400, `Asset variant content type must be ${expectedMime}`)
    await scanStoredObject(variant.key)
    variants.push({ key: variant.key, url: ObjectStorageService.publicUrl(variant.key), format: variant.format, width: Number(variant.width), height: variant.height ? Number(variant.height) : undefined, size: meta.size })
  }
  const totalSize = original.size + variants.reduce((sum: number, v: any) => sum + v.size, 0)
  const previousSize = Number(existingAsset?.size || 0)
  const storageDelta = Math.max(0, totalSize - previousSize)
  if (storageDelta) await EntitlementService.assertStorage(organizationId, storageDelta)
  const asset = await WebsiteAsset.findOneAndUpdate({ organizationId, key: payload.key }, { $set: { url: ObjectStorageService.publicUrl(payload.key), originalName: String(payload.originalName || '').slice(0, 255), mimeType: payload.mimeType, width: payload.width, height: payload.height, size: totalSize, altText: String(payload.altText || '').slice(0, 300), status: 'ready', etag: original.etag, scanStatus: scan.status, variants, uploadedBy: userId, lastReferencedAt: new Date() } }, { new: true, upsert: true, setDefaultsOnInsert: true })
  const delta = totalSize - previousSize
  if (delta) await Organization.updateOne({ organizationId }, { $inc: { storageUsedBytes: delta } })
  if (intent) await intent.deleteOne()
  return asset
}

const listAssets = async (organizationId: string) => WebsiteAsset.find({ organizationId, status: 'ready' }).sort({ createdAt: -1 }).limit(200)
const assetIsReferenced = async (organizationId: string, asset: any) => {
  const needles = [asset.key, asset.url, ...(asset.variants || []).flatMap((variant: any) => [variant.key, variant.url])].filter(Boolean)
  const pages = await WebsitePage.find({ organizationId }).select('draftDocument publishedDocument').lean()
  return pages.some((page) => { const serialized = JSON.stringify(page); return needles.some((needle) => serialized.includes(String(needle))) })
}
const deleteAsset = async (organizationId: string, assetId: string, allowReferenced = false) => {
  const asset = await WebsiteAsset.findOne({ _id: assetId, organizationId })
  if (!asset) throw new ApiError(404, 'Asset not found or unauthorized')
  if (!allowReferenced && await assetIsReferenced(organizationId, asset)) throw new ApiError(409, 'Asset is still used by a draft or published page')
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

const canonicalBase = async (org: any) => {
  const verified = org.domain ? await DomainRecord.findOne({ organizationId: org.organizationId, domain: org.domain, status: 'verified', tlsStatus: 'active' }).lean() : null
  return verified ? `https://${verified.domain}` : `${config.domains.public_site_origin}/portal/${org.sub_domain || org.organizationId}`
}

const getPublicPage = async (identifier: string, slug = '/') => {
  const targetSlug = !slug || slug === 'home' ? '/' : `/${slug}`.replace(/\/+/g, '/')
  const org = await resolveOrganization(identifier)
  if (!org) throw new ApiError(404, 'Agency website not found')
  const cached = await WebsiteCache.get<any>('published', org.organizationId, targetSlug)
  if (cached) return cached
  const page = await WebsitePage.findOne({ organizationId: org.organizationId, slug: targetSlug, status: 'published', publishedDocument: { $ne: null } }).lean()
  const base = await canonicalBase(org)
  const result = { organization: { organizationId: org.organizationId, agencyName: org.agencyName, logo: org.logo, primaryColor: org.primaryColor, secondaryColor: org.secondaryColor, sub_domain: org.sub_domain, domain: org.domain }, page: page ? { title: page.title, slug: page.slug, publishedDocument: page.publishedDocument, seo: { ...(page.seo || {}), canonicalUrl: page.seo?.canonicalUrl || `${base}${targetSlug === '/' ? '' : targetSlug}` } } : null }
  await WebsiteCache.set('published', org.organizationId, targetSlug, result, 300)
  return result
}

const getSitemap = async (identifier: string) => {
  const org = await resolveOrganization(identifier); if (!org) throw new ApiError(404, 'Agency website not found')
  const base = await canonicalBase(org)
  const [pages, properties] = await Promise.all([WebsitePage.find({ organizationId: org.organizationId, status: 'published' }).select('slug updatedAt').lean(), Property.find({ organizationId: org.organizationId, status: 'Available', moderationStatus: 'approved' }).select('_id updatedAt').lean()])
  return { base, urls: [...pages.map((p: any) => ({ loc: `${base}${p.slug === '/' ? '' : p.slug}`, lastmod: p.updatedAt })), ...properties.map((p: any) => ({ loc: `${base}/properties/${p._id}`, lastmod: p.updatedAt }))] }
}

const getRobots = async (identifier: string) => { const org = await resolveOrganization(identifier); if (!org) throw new ApiError(404, 'Agency website not found'); const base = await canonicalBase(org); return `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n` }
const getPropertyShareCard = async (identifier: string, propertyId: string) => { const org = await resolveOrganization(identifier); if (!org) throw new ApiError(404, 'Agency website not found'); const property: any = await Property.findOne({ _id: propertyId, organizationId: org.organizationId, moderationStatus: 'approved' }).lean(); if (!property) throw new ApiError(404, 'Property not found'); const base = await canonicalBase(org); return { title: `${property.title} | ${org.agencyName}`, description: String(property.description || `${property.bedrooms || ''} bed property in ${property.city || 'Bangladesh'}`).replace(/<[^>]+>/g, '').slice(0, 180), image: property.images?.[0]?.url || org.logo || '', url: `${base}/properties/${property._id}`, type: 'website', structuredData: { '@context': 'https://schema.org', '@type': 'RealEstateListing', name: property.title, url: `${base}/properties/${property._id}`, image: property.images?.map((i: any) => i.url).filter(Boolean) || [], offers: { '@type': 'Offer', price: property.price, priceCurrency: property.currency || 'BDT' } } } }

export const WebsiteBuilderService = { getAllPages, getPageById, saveDraft, publishPage, schedulePublish, processScheduledPublishes, listRevisions, restoreRevision, createPreviewToken, getPreview, presignAsset, completeAsset, listAssets, deleteAsset, cleanupOrphanAssets, getPublicPage, getSitemap, getRobots, getPropertyShareCard, listTemplates: TemplateRegistry.list }
