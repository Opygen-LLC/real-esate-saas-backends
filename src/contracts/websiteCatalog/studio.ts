// Backend-owned Studio wire contract. Generated into the frontend; never hand-copy.
import type { WebsiteContentPatch } from './content'
import type { WebsiteDesignContract, WebsiteRenderMode, WebsiteSectionStyles } from './architecture'
import type { WebsiteTemplateId, WebsiteRendererVersion } from './manifest'

export const STUDIO_SCHEMA_VERSION = 1 as const
export const STUDIO_FONTS = ['Inter', 'Geist', 'Poppins', 'Manrope', 'Roboto', 'Playfair Display'] as const
export const STUDIO_AREAS = ['content', 'design', 'branding', 'inquiry', 'seo'] as const
export type StudioArea = typeof STUDIO_AREAS[number]
export type StudioImageOptions = {
  alt: string
  decorative?: boolean
  focalPoint: { x: number; y: number }
  fit: 'cover' | 'contain'
}
export const STUDIO_IMAGE_SLOTS = ['home.heroImage', 'about.image'] as const
export type StudioImageSlot = typeof STUDIO_IMAGE_SLOTS[number]
export const DEFAULT_IMAGE_OPTIONS: StudioImageOptions = { alt: '', focalPoint: { x: 50, y: 50 }, fit: 'cover' }
export type StudioMedia = Partial<Record<StudioImageSlot, StudioImageOptions>>
export type StudioSocialLinks = Partial<Record<'facebook' | 'instagram' | 'youtube' | 'x' | 'linkedin' | 'whatsapp', string>>
export type StudioFooter = { showSocialLinks?: boolean; socialVisibility?: Partial<Record<'facebook' | 'instagram' | 'youtube' | 'x', boolean>> }
export const STUDIO_ORDERABLE_SECTIONS = {
  home: ['home.hero', 'home.featuredProperties', 'home.whyChooseUs', 'home.reviews', 'home.agents', 'home.consultation'],
  about: ['about.hero', 'about.story', 'about.stats', 'about.cta'],
} as const
export const STUDIO_HIDEABLE_SECTIONS = [
  ...STUDIO_ORDERABLE_SECTIONS.home, ...STUDIO_ORDERABLE_SECTIONS.about,
  'about.values', 'properties.hero', 'agents.hero', 'agents.cta', 'contact.hero', 'contact.office', 'contact.map',
] as const
export type StudioLayout = {
  homeOrder?: (typeof STUDIO_ORDERABLE_SECTIONS.home[number])[]
  aboutOrder?: (typeof STUDIO_ORDERABLE_SECTIONS.about[number])[]
  hiddenSections?: (typeof STUDIO_HIDEABLE_SECTIONS[number])[]
}
export const normalizeStudioLayout = (value: unknown): StudioLayout => {
  if (!value || typeof value !== 'object') return {}
  const input = value as Record<string, unknown>
  const result: Record<string, string[]> = {}
  for (const [key, allowed] of Object.entries({ homeOrder: STUDIO_ORDERABLE_SECTIONS.home, aboutOrder: STUDIO_ORDERABLE_SECTIONS.about, hiddenSections: STUDIO_HIDEABLE_SECTIONS })) {
    const values = input[key]
    if (Array.isArray(values)) result[key] = [...new Set(values.filter((entry): entry is string => typeof entry === 'string' && (allowed as readonly string[]).includes(entry)))]
  }
  return result as StudioLayout
}
export type StudioWebsiteSettings = {
  renderMode: WebsiteRenderMode
  rendererVersion: WebsiteRendererVersion
  content: WebsiteContentPatch
  contentSchemaVersion: number
  sectionStyles: WebsiteSectionStyles
  websiteDesign: WebsiteDesignContract
  layout?: StudioLayout
  media?: StudioMedia
  footer?: StudioFooter
  featuredPropertiesCount?: number
  enableTestimonials?: boolean
  enableLeadForm?: boolean
  enableWhatsAppChat?: boolean
}
/** Only presentation-owned data. No subscription, tenant ID, property facts or agency identity writes. */
export type StudioSnapshot = {
  schemaVersion: typeof STUDIO_SCHEMA_VERSION
  templateId: WebsiteTemplateId
  logo: string
  favicon: string
  primaryColor: string
  secondaryColor: string
  font: typeof STUDIO_FONTS[number]
  metaTitle: string
  metaDescription: string
  defaultLanguage: 'en' | 'bn'
  socialLinks: StudioSocialLinks
  websiteSettings: StudioWebsiteSettings
}
export type StudioPatch = Partial<Omit<StudioSnapshot, 'schemaVersion' | 'websiteSettings'>> & {
  websiteSettings?: Partial<StudioWebsiteSettings>
}
export type StudioBuilderPage = { id: string; slug: string; title: string; publishedDocument: Record<string, unknown> | null; seo: Record<string, unknown>; publishedVersion: number }
export type StudioState = {
  schemaVersion: typeof STUDIO_SCHEMA_VERSION
  draftRevision: number
  basePublicationRevision: number
  publicationRevision: number
  publishedDraftRevision: number | null
  hasUnpublishedChanges: boolean
  liveChanged: boolean
  updatedAt: string | null
  publishedAt: string | null
  snapshot: StudioSnapshot
}
export type StudioSaveRequest = { expectedDraftRevision: number; expectedPublicationRevision: number; mutationId: string; patch: StudioPatch }
export type StudioPublishRequest = { expectedDraftRevision: number; expectedPublicationRevision: number; mutationId: string }
export type StudioRestoreRequest = StudioPublishRequest & { revision: number }
export type StudioHistoryEntry = { revision: number; publishedAt: string; templateId: WebsiteTemplateId; renderMode: WebsiteRenderMode; rendererVersion: WebsiteRendererVersion; message: string }
export type StudioPreviewResponse<TSite = unknown> = {
  draftRevision: number
  publicationRevision: number
  snapshot: StudioSnapshot
  site: TSite
  builderPages: StudioBuilderPage[]
}
export const isStudioRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
/** Stable JSON comparison for dirty state and idempotency fingerprints; input is JSON-only. */
export const stableStudioJson = (value: unknown): string => {
  const normalize = (item: unknown): unknown => Array.isArray(item)
    ? item.map(normalize)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)]))
      : item
  return JSON.stringify(normalize(value))
}
export const normalizeStudioMedia = (value: unknown): StudioMedia => {
  if (!value || typeof value !== 'object') return {}
  const input = value as Record<string, unknown>
  const result: StudioMedia = {}
  for (const slot of STUDIO_IMAGE_SLOTS) {
    const [group, key] = slot.split('.')
    const nested = input[group] as Record<string, unknown> | undefined
    const item = (input[slot] || nested?.[key]) as StudioImageOptions | undefined
    if (!item || typeof item !== 'object') continue
    const clamp = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 50
    result[slot] = { alt: typeof item.alt === 'string' ? item.alt.slice(0, 300) : '', decorative: item.decorative === true, focalPoint: { x: clamp(item.focalPoint?.x), y: clamp(item.focalPoint?.y) }, fit: item.fit === 'contain' ? 'contain' : 'cover' }
  }
  return result
}
export const serializeStudioMedia = (value: StudioMedia): Record<string, Record<string, StudioImageOptions>> => {
  const result: Record<string, Record<string, StudioImageOptions>> = {}
  for (const [slot, options] of Object.entries(normalizeStudioMedia(value))) {
    const [group, key] = slot.split('.')
    ;(result[group] ||= {})[key] = options
  }
  return result
}
