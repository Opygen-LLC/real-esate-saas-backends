import { createHash } from 'crypto'
import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { requiredTransaction } from '../../db/requiredTransaction'
import { Organization } from '../organization/organization.model'
import { serializePublicWebsite } from '../organization/organization.service'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { writeAudit } from '../audit/audit.service'
import { TransactionalOutbox } from '../domainEvent/transactionalOutbox.service'
import { WebsitePublicationService } from './websitePublication.service'
import { WebsiteArchitectureService } from './websiteArchitecture.service'
import { WebsiteDesignService, type WebsiteDesignActor } from './websiteDesign.service'
import { mergeAndMigrateContent, assertContentPropertyReferences } from './websiteContent.service'
import { WebsiteStudio, WebsiteStudioReceipt, WebsiteStudioRevision, type IWebsiteStudio } from './websiteStudio.model'
import { WebsitePage } from './websitePage.model'
import { WebsiteRevision } from './websiteRevision.model'
import { TemplateRegistry } from './templateRegistry'
import { WebsiteAsset } from './websiteAsset.model'
import { studioPatchSchema } from './websiteStudio.validation'
import { STUDIO_FONTS, STUDIO_SCHEMA_VERSION, stableStudioJson, normalizeStudioMedia, normalizeStudioLayout, serializeStudioMedia, type StudioSnapshot, type StudioState, type StudioBuilderPage, type StudioSaveRequest, type StudioPublishRequest, type StudioRestoreRequest, type StudioPatch } from '../../../contracts/websiteCatalog/studio'
import { collectStudioImageUrls, isBundledStudioImage } from './websiteStudioAssets.policy'

const conflict = (message = 'This website changed in another session. Your local edits are safe; review the latest draft before saving again.') => new ApiError(409, message, '', 'STUDIO_REVISION_CONFLICT')
const revisionOf = (org: any): number => Math.max(0, Number(org.websiteSettings?.publicationRevision || 0))
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const assertSize = (snapshot: unknown) => { if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 512 * 1024) throw new ApiError(413, 'Website content exceeds the 512 KiB limit') }

export const snapshotFromOrganization = (org: any): StudioSnapshot => {
  const migrated = mergeAndMigrateContent(org.websiteSettings, undefined, org.templateId || 'template-1')
  const settings = org.websiteSettings || {}
  return plain({
    schemaVersion: STUDIO_SCHEMA_VERSION,
    templateId: org.templateId || 'template-1',
    logo: org.logo || '', favicon: org.favicon || '',
    primaryColor: org.primaryColor || '#1877F2', secondaryColor: org.secondaryColor || '#0f172a',
    font: STUDIO_FONTS.includes(org.font) ? org.font : 'Inter',
    metaTitle: org.metaTitle || '', metaDescription: org.metaDescription || '', defaultLanguage: org.defaultLanguage || 'en',
    socialLinks: Object.fromEntries(['facebook', 'instagram', 'youtube', 'x', 'linkedin', 'whatsapp'].map((key) => [key, org.socialLinks?.[key] ?? settings.socialLinks?.[key] ?? (key === 'x' ? org.socialLinks?.twitter : '') ?? ''])),
    websiteSettings: {
      renderMode: settings.renderMode === 'builder' ? 'builder' : 'template',
      content: migrated.content, contentSchemaVersion: migrated.contentSchemaVersion,
      sectionStyles: WebsiteArchitectureService.canonicalizeSectionStyles(settings.sectionStyles),
      websiteDesign: WebsiteArchitectureService.canonicalizeWebsiteDesign(settings.websiteDesign),
      media: normalizeStudioMedia(settings.media), layout: normalizeStudioLayout(settings.layout),
      footer: settings.footer || { showSocialLinks: true, socialVisibility: { facebook: true, instagram: true, youtube: true, x: true } },
      featuredPropertiesCount: settings.featuredPropertiesCount ?? 6,
      enableTestimonials: settings.enableTestimonials !== false, enableLeadForm: settings.enableLeadForm !== false, enableWhatsAppChat: settings.enableWhatsAppChat !== false,
    },
  })
}

/** Store dotted editor slot maps as ordinary nested Mongo fields. API snapshots remain canonical/flat. */
export const snapshotForStorage = (snapshot: StudioSnapshot): StudioSnapshot => ({
  ...plain(snapshot), websiteSettings: { ...plain(snapshot.websiteSettings),
    sectionStyles: WebsiteArchitectureService.serializeSectionStylesForStorage(snapshot.websiteSettings.sectionStyles),
    media: serializeStudioMedia(snapshot.websiteSettings.media || {}),
  },
} as unknown as StudioSnapshot)
const snapshotFromStorage = (snapshot: StudioSnapshot): StudioSnapshot => snapshotFromOrganization(snapshot)

export const applyStudioPatch = (before: StudioSnapshot, patch: StudioPatch): StudioSnapshot => {
  // Validated patches are merged only within their area. Clearing a collection is intentional.
  const next = { ...before, ...patch, schemaVersion: STUDIO_SCHEMA_VERSION, socialLinks: { ...before.socialLinks, ...patch.socialLinks }, websiteSettings: { ...before.websiteSettings, ...patch.websiteSettings } }
  const content = mergeAndMigrateContent(before.websiteSettings, patch.websiteSettings?.content, next.templateId)
  next.websiteSettings.content = content.content
  next.websiteSettings.contentSchemaVersion = content.contentSchemaVersion
  next.websiteSettings.sectionStyles = WebsiteArchitectureService.canonicalizeSectionStyles(next.websiteSettings.sectionStyles)
  next.websiteSettings.websiteDesign = WebsiteArchitectureService.canonicalizeWebsiteDesign(next.websiteSettings.websiteDesign)
  next.websiteSettings.media = normalizeStudioMedia(next.websiteSettings.media)
  next.websiteSettings.layout = normalizeStudioLayout(next.websiteSettings.layout)
  assertSize(next)
  return plain(next)
}

const organization = async (organizationId: string, session?: ClientSession) => {
  const org = await Organization.findOne({ organizationId }).session(session || null).lean()
  if (!org) throw new ApiError(404, 'Organization not found')
  if ((org as any).platformAccess?.status === 'pending_deletion') throw new ApiError(423, 'Organization is being deleted')
  return org
}
const publishedBuilderPages = async (organizationId: string, session?: ClientSession): Promise<StudioBuilderPage[]> => {
  const pages = await WebsitePage.find({ organizationId, publishedDocument: { $ne: null } }).sort({ slug: 1 }).limit(101).session(session || null).lean()
  if (pages.length > 100) throw new ApiError(413, 'This website exceeds the 100-page Studio snapshot limit')
  const result = pages.map((page) => ({ id: String(page._id), slug: page.slug, title: page.title, publishedDocument: plain(page.publishedDocument || null), seo: plain(page.seo || {}), publishedVersion: page.publishedVersion || 0 }))
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 1_200_000) throw new ApiError(413, 'Advanced page snapshots exceed the 1.2 MB Studio preview limit. Continue using the advanced page editor.')
  return result
}
const load = async (organizationId: string, org: any, session?: ClientSession): Promise<IWebsiteStudio> => {
  const stored = await WebsiteStudio.findOne({ organizationId }).session(session || null).lean()
  if (stored) {
    if (stored.schemaVersion !== STUDIO_SCHEMA_VERSION) throw new ApiError(409, 'Update Studio before editing this newer workspace')
    return { ...stored, snapshot: snapshotFromStorage(stored.snapshot) }
  }
  return { organizationId, schemaVersion: STUDIO_SCHEMA_VERSION, draftRevision: 0, basePublicationRevision: revisionOf(org), publishedDraftRevision: 0, snapshot: snapshotFromOrganization(org), builderPages: await publishedBuilderPages(organizationId, session) }
}
const toState = (studio: IWebsiteStudio, org: any): StudioState => ({
  schemaVersion: STUDIO_SCHEMA_VERSION,
  draftRevision: studio.draftRevision, basePublicationRevision: studio.basePublicationRevision,
  publicationRevision: revisionOf(org), publishedDraftRevision: studio.publishedDraftRevision,
  hasUnpublishedChanges: studio.publishedDraftRevision !== studio.draftRevision,
  liveChanged: studio.basePublicationRevision !== revisionOf(org),
  updatedAt: studio.updatedAt?.toISOString() || null,
  publishedAt: org.websiteSettings?.lastPublishedAt ? new Date(org.websiteSettings.lastPublishedAt).toISOString() : null,
  snapshot: snapshotFromStorage(studio.snapshot),
})
const getState = async (organizationId: string): Promise<StudioState> => {
  const org = await organization(organizationId)
  return toState(await load(organizationId, org), org)
}
export const assertStudioRevisions = (studio: Pick<IWebsiteStudio, 'draftRevision' | 'basePublicationRevision'>, publicationRevision: number, request: StudioPublishRequest, allowLiveChanged = false) => {
  if (studio.draftRevision !== request.expectedDraftRevision || publicationRevision !== request.expectedPublicationRevision || (!allowLiveChanged && studio.basePublicationRevision !== publicationRevision)) throw conflict()
}
const persistDraft = async (studio: IWebsiteStudio, session: ClientSession): Promise<IWebsiteStudio> => {
  assertSize(studio.snapshot)
  const updated = await WebsiteStudio.findOneAndUpdate(
    { organizationId: studio.organizationId, draftRevision: studio.draftRevision - 1 },
    { $set: { schemaVersion: studio.schemaVersion, snapshot: snapshotForStorage(studio.snapshot), builderPages: studio.builderPages, draftRevision: studio.draftRevision, basePublicationRevision: studio.basePublicationRevision, publishedDraftRevision: studio.publishedDraftRevision, updatedBy: studio.updatedBy } },
    { new: true, session },
  ).lean()
  if (updated) return updated
  if (studio.draftRevision !== 1) throw conflict()
  return (await WebsiteStudio.create([{ ...studio, snapshot: snapshotForStorage(studio.snapshot) }], { session }))[0].toObject()
}

const validateAssets = async (organizationId: string, before: StudioSnapshot, next: StudioSnapshot, session: ClientSession) => {
  const previous = new Set(collectStudioImageUrls(before))
  for (const url of collectStudioImageUrls(next)) {
    if (isBundledStudioImage(url)) continue
    const asset = await WebsiteAsset.findOne({ organizationId, $or: [{ url }, { 'variants.url': url }] }).session(session).lean()
    if (!asset) {
      // Preserve legacy external URLs, but never accept a new unmanaged/cross-tenant selection.
      if (previous.has(url)) continue
      throw new ApiError(400, 'Choose a ready image from your website library or import it first', '', 'STUDIO_ASSET_NOT_OWNED')
    }
    if (asset.status !== 'ready' || asset.context === 'property' || asset.context === 'property-draft') throw new ApiError(409, 'Image is unavailable or belongs to a property. Use the property editor for listing photos.')
    // Conflicts with a concurrent asset deletion in its transaction.
    const touched = await WebsiteAsset.updateOne({ _id: asset._id, organizationId, status: 'ready' }, { $set: { lastReferencedAt: new Date() } }, { session })
    if (touched.matchedCount !== 1) throw conflict('The selected image was removed. Choose another image.')
  }
}
const validateDraft = async (organizationId: string, before: StudioSnapshot, next: StudioSnapshot, session: ClientSession, publishing = false) => {
  if (publishing || next.templateId !== before.templateId) await TemplateRegistry.assertEntitlement(organizationId, { template: { id: next.templateId } })
  await WebsiteDesignService.validateDraftDesign(organizationId, publishing ? WebsiteArchitectureService.canonicalizeWebsiteDesign({}) : before.websiteSettings.websiteDesign, next.websiteSettings.websiteDesign)
  await assertContentPropertyReferences(organizationId, next.websiteSettings.content, before.websiteSettings.content)
  await validateAssets(organizationId, before, next, session)
}

const runMutation = async (organizationId: string, kind: string, request: StudioPublishRequest, actor: WebsiteDesignActor, work: (studio: IWebsiteStudio, org: any, session: ClientSession) => Promise<StudioState>): Promise<StudioState> => {
  const fingerprint = createHash('sha256').update(stableStudioJson({ kind, request })).digest('hex')
  const replay = async (session?: ClientSession) => {
    const receipt = await WebsiteStudioReceipt.findOne({ organizationId, mutationId: request.mutationId, expiresAt: { $gt: new Date() } }).session(session || null).lean()
    if (!receipt) return null
    if (receipt.fingerprint !== fingerprint) throw new ApiError(409, 'Mutation key was already used for a different operation', '', 'STUDIO_IDEMPOTENCY_CONFLICT')
    return { ...(receipt.result as StudioState), snapshot: snapshotFromStorage((receipt.result as StudioState).snapshot) }
  }
  const previous = await replay()
  if (previous) return previous
  try {
    return await requiredTransaction(async (session) => {
      const prior = await replay(session)
      if (prior) return prior
      const org = await organization(organizationId, session)
      const studio = await load(organizationId, org, session)
      const result = await work(studio, org, session)
      await WebsiteStudioReceipt.create([{ organizationId, mutationId: request.mutationId, fingerprint, result: { ...result, snapshot: snapshotForStorage(result.snapshot) }, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) }], { session })
      await writeAudit({ organizationId, actorId: actor.actorId, actorRole: actor.actorRole, action: `website.studio_${kind}`, entityType: 'website', entityId: organizationId, requestId: actor.requestId, ip: actor.ip, metadata: { draftRevision: result.draftRevision, publicationRevision: result.publicationRevision } }, session)
      return result
    })
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const completed = await replay()
      if (completed) return completed
      throw conflict()
    }
    throw error
  }
}
const saveDraft = (organizationId: string, request: StudioSaveRequest, actor: WebsiteDesignActor = {}) => runMutation(organizationId, 'draft_saved', request, actor, async (studio, org, session) => {
  assertStudioRevisions(studio, revisionOf(org), request)
  const patch = studioPatchSchema.parse(request.patch) as StudioPatch
  const next = applyStudioPatch(studio.snapshot, patch)
  await validateDraft(organizationId, studio.snapshot, next, session)
  if (stableStudioJson(next) === stableStudioJson(studio.snapshot)) return toState(studio, org)
  const updated = await persistDraft({ ...studio, snapshot: next, draftRevision: studio.draftRevision + 1, updatedBy: actor.actorId }, session)
  return toState(updated, org)
})

const publishedSet = (snapshot: StudioSnapshot) => {
  const { schemaVersion: _schema, websiteSettings, ...root } = snapshot
  const { renderMode: _mode, ...settings } = websiteSettings
  return { ...root, ...Object.fromEntries(Object.entries(settings).map(([key, value]) => [`websiteSettings.${key}`, key === 'sectionStyles' ? WebsiteArchitectureService.serializeSectionStylesForStorage(websiteSettings.sectionStyles) : key === 'media' ? serializeStudioMedia(websiteSettings.media || {}) : value])) }
}
const snapshotHistory = async (organizationId: string, revision: number, snapshot: StudioSnapshot, pages: StudioBuilderPage[], publishedAt: Date, session: ClientSession, createdBy?: string, message = 'Website published') => {
  await WebsiteStudioRevision.updateOne({ organizationId, revision }, { $setOnInsert: { organizationId, revision, snapshot: snapshotForStorage(snapshot), builderPages: pages, publishedAt, createdBy, message } }, { upsert: true, session })
}
const restoreBuilderPublication = async (organizationId: string, pages: StudioBuilderPage[], session: ClientSession, actorId?: string) => {
  for (const snapshot of pages) {
    const page = await WebsitePage.findOne({ organizationId, _id: snapshot.id }).session(session)
    if (!page) throw new ApiError(409, `The saved builder page ${snapshot.slug} no longer exists`)
    if (stableStudioJson(page.publishedDocument || null) === stableStudioJson(snapshot.publishedDocument) && stableStudioJson(page.seo || {}) === stableStudioJson(snapshot.seo) && page.status === 'published' && !page.scheduledPublishAt) continue
    const latest = await WebsiteRevision.findOne({ organizationId, pageId: page._id }).sort({ version: -1 }).session(session).lean()
    const version = Number(latest?.version || 0) + 1
    await WebsiteRevision.create([{ organizationId, pageId: page._id, document: snapshot.publishedDocument || {}, schemaVersion: 2, version, createdBy: actorId, message: 'Restored through Website Studio publication' }], { session })
    await WebsitePage.updateOne({ _id: page._id, organizationId }, { $set: { publishedDocument: snapshot.publishedDocument, publishedVersion: version, publishedAt: new Date(), seo: snapshot.seo, scheduledPublishAt: null, status: 'published' } }, { session })
  }
  // Revision rollback cannot leave newer pages publicly reachable.
  await WebsitePage.updateMany({ organizationId, _id: { $nin: pages.map((page) => page.id) }, publishedDocument: { $ne: null } }, { $set: { publishedDocument: null, scheduledPublishAt: null, status: 'draft' } }, { session })
}
const publish = (organizationId: string, request: StudioPublishRequest, actor: WebsiteDesignActor = {}) => runMutation(organizationId, 'published', request, actor, async (studio, org, session) => {
  assertStudioRevisions(studio, revisionOf(org), request)
  await validateDraft(organizationId, snapshotFromOrganization(org), studio.snapshot, session, true)
  // Keep the pre-Studio live website available as an undo target as well.
  await snapshotHistory(organizationId, revisionOf(org), snapshotFromOrganization(org), await publishedBuilderPages(organizationId, session), new Date(org.websiteSettings?.lastPublishedAt || org.updatedAt || Date.now()), session, actor.actorId, 'Previous live website')
  if (studio.snapshot.websiteSettings.renderMode === 'builder') {
    if (!studio.builderPages.some((page) => page.slug === '/' && page.publishedDocument)) throw new ApiError(409, 'Publish a builder home page before selecting builder mode')
    await restoreBuilderPublication(organizationId, studio.builderPages, session, actor.actorId)
  }
  const publication = await WebsitePublicationService.commitPublicationState({ organizationId, renderMode: studio.snapshot.websiteSettings.renderMode, set: publishedSet(studio.snapshot), expectedPublicationRevision: request.expectedPublicationRevision, session })
  const next: IWebsiteStudio = { ...studio, draftRevision: studio.draftRevision + 1, publishedDraftRevision: studio.draftRevision + 1, basePublicationRevision: publication.publicationRevision, updatedBy: actor.actorId }
  const updated = await persistDraft(next, session)
  await snapshotHistory(organizationId, publication.publicationRevision, studio.snapshot, studio.builderPages, new Date(publication.lastPublishedAt), session, actor.actorId)
  await TransactionalOutbox.emit({ organizationId, aggregateType: 'website', aggregateId: organizationId, eventType: 'website.published', actorId: actor.actorId, payload: { renderMode: studio.snapshot.websiteSettings.renderMode, publicationRevision: publication.publicationRevision, publicVisible: true } }, session)
  return toState(updated, publication.organization)
})
const restore = (organizationId: string, request: StudioRestoreRequest, actor: WebsiteDesignActor = {}) => runMutation(organizationId, 'revision_restored', request, actor, async (studio, org, session) => {
  assertStudioRevisions(studio, revisionOf(org), request, true)
  const revision = await WebsiteStudioRevision.findOne({ organizationId, revision: request.revision }).session(session).lean()
  if (!revision) throw new ApiError(404, 'Published revision not found for this website')
  if (revision.snapshot.schemaVersion !== STUDIO_SCHEMA_VERSION) throw new ApiError(409, 'This revision uses an unsupported Studio schema')
  const restored = snapshotFromStorage(revision.snapshot)
  await validateDraft(organizationId, studio.snapshot, restored, session)
  const updated = await persistDraft({ ...studio, snapshot: restored, builderPages: plain(revision.builderPages), draftRevision: studio.draftRevision + 1, basePublicationRevision: revisionOf(org), updatedBy: actor.actorId }, session)
  return toState(updated, org)
})
const resetFromPublished = (organizationId: string, request: StudioPublishRequest, actor: WebsiteDesignActor = {}) => runMutation(organizationId, 'draft_reset', request, actor, async (studio, org, session) => {
  assertStudioRevisions(studio, revisionOf(org), request, true)
  const next = { ...studio, snapshot: snapshotFromOrganization(org), builderPages: await publishedBuilderPages(organizationId, session), draftRevision: studio.draftRevision + 1, publishedDraftRevision: studio.draftRevision + 1, basePublicationRevision: revisionOf(org), updatedBy: actor.actorId }
  return toState(await persistDraft(next, session), org)
})
const history = async (organizationId: string) => (await WebsiteStudioRevision.find({ organizationId }).select('revision publishedAt snapshot.templateId snapshot.websiteSettings.renderMode message').sort({ revision: -1 }).limit(50).lean()).map((entry) => ({ revision: entry.revision, publishedAt: entry.publishedAt.toISOString(), templateId: entry.snapshot.templateId, renderMode: entry.snapshot.websiteSettings.renderMode, message: entry.message }))
const preview = async (organizationId: string, expectedDraftRevision: number) => {
  const org = await organization(organizationId)
  const studio = await load(organizationId, org)
  if (studio.draftRevision !== expectedDraftRevision || studio.basePublicationRevision !== revisionOf(org)) throw conflict('Save or reload the latest draft before previewing.')
  const snapshot = studio.snapshot
  const [totalProperties, totalAgents] = await Promise.all([
    Property.countDocuments({ organizationId, status: 'Available', quotaLocked: { $ne: true } }),
    User.countDocuments({ organizationId, userRole: { $in: ['agent', 'agency_admin', 'agency_owner', 'admin'] } }),
  ])
  const site = serializePublicWebsite({ ...org, ...snapshot, websiteSettings: { ...org.websiteSettings, ...snapshot.websiteSettings }, websiteStatus: 'published' }, { totalProperties, totalAgents })
  return { draftRevision: studio.draftRevision, publicationRevision: revisionOf(org), snapshot: plain(snapshot), site, builderPages: plain(studio.builderPages) }
}
export const WebsiteStudioService = { getState, saveDraft, publish, restore, resetFromPublished, history, preview }
