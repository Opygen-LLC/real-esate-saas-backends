import { z } from 'zod'
import { STUDIO_FONTS, STUDIO_IMAGE_SLOTS, STUDIO_ORDERABLE_SECTIONS, STUDIO_HIDEABLE_SECTIONS } from '../../../contracts/websiteCatalog/studio'
import { WEBSITE_TEMPLATE_IDS } from './websiteTemplate.constants'
import { WEBSITE_RENDERER_VERSIONS } from '../../../contracts/websiteCatalog/manifest'
import { websiteSettingsSchema, websiteSocialLinksSchema } from '../organization/organization.validation'

const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const mutationId = z.string().uuid()
const image = z.object({
  alt: z.string().max(300), decorative: z.boolean().optional(),
  focalPoint: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).strict(),
  fit: z.enum(['cover', 'contain']),
}).strict()
export const studioMediaSchema = z.record(z.enum(STUDIO_IMAGE_SLOTS), image)
export const studioLayoutSchema = z.object({
  homeOrder: z.array(z.enum(STUDIO_ORDERABLE_SECTIONS.home)).max(6).refine((items) => new Set(items).size === items.length, 'Each section may appear only once').optional(),
  aboutOrder: z.array(z.enum(STUDIO_ORDERABLE_SECTIONS.about)).max(5).refine((items) => new Set(items).size === items.length, 'Each section may appear only once').optional(),
  hiddenSections: z.array(z.enum(STUDIO_HIDEABLE_SECTIONS)).max(STUDIO_HIDEABLE_SECTIONS.length).refine((items) => new Set(items).size === items.length, 'Duplicate hidden section').optional(),
}).strict()
const imageUrl = z.string().max(2048).refine((value) => {
  if (value === '') return true
  if (/^\/website-media\/[a-z0-9-]+\.(?:webp|jpg|png)$/.test(value)) return true
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password } catch { return false }
}, 'Choose a managed image from the library, upload, or approved defaults')
export const studioPatchSchema = z.object({
  templateId: z.enum(WEBSITE_TEMPLATE_IDS).optional(),
  logo: imageUrl.optional(), favicon: imageUrl.optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  font: z.enum(STUDIO_FONTS).optional(), metaTitle: z.string().max(120).optional(), metaDescription: z.string().max(300).optional(),
  defaultLanguage: z.enum(['en', 'bn']).optional(), socialLinks: websiteSocialLinksSchema.optional(),
  websiteSettings: websiteSettingsSchema.omit({ heroTitle: true, heroSubtitle: true, heroImage: true }).extend({ rendererVersion: z.enum(WEBSITE_RENDERER_VERSIONS).optional(), media: studioMediaSchema.optional(), layout: studioLayoutSchema.optional() }).strict().optional(),
}).strict().refine((input) => Object.keys(input).length > 0, 'Change at least one field')
const expected = { expectedDraftRevision: revision, expectedPublicationRevision: revision, mutationId }
export const WebsiteStudioValidation = {
  assets: z.object({ query: z.object({ cursor: z.string().regex(/^[a-f\d]{24}$/i).optional(), search: z.string().max(80).optional() }).strict() }),
  save: z.object({ body: z.object({ ...expected, patch: studioPatchSchema }).strict() }),
  publish: z.object({ body: z.object(expected).strict() }),
  restore: z.object({ body: z.object({ ...expected, revision }).strict() }),
  reset: z.object({ body: z.object(expected).strict() }),
  preview: z.object({ query: z.object({ draftRevision: z.string().regex(/^\d{1,16}$/).transform(Number).refine(Number.isSafeInteger) }).strict() }),
}
