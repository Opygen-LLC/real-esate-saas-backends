import { z } from 'zod'
import { WEBSITE_TEMPLATE_IDS } from './websiteTemplate.constants'
import {
  WEBSITE_ANIMATION_DURATIONS,
  WEBSITE_ANIMATION_PRESETS,
  WEBSITE_ANIMATION_TRIGGERS,
  WEBSITE_COMPONENT_SLOTS,
  WEBSITE_DESIGN_SCHEMA_VERSION,
} from './websiteArchitecture.contract'

export const nodeAnimationSchema = z.object({
  name: z.enum(['none','fade-in','fade-up','fade-down','fade-left','fade-right','zoom-in','slide-up','blur-in']),
  duration: z.number().min(0).max(10000).default(600), delay: z.number().min(0).max(10000).default(0),
  easing: z.enum(['linear','ease','ease-in','ease-out','ease-in-out']).default('ease-out'), trigger: z.enum(['onload','onviewport']).default('onload'),
}).strict()
export const builderNodeSchema: z.ZodType<any> = z.lazy(() => z.object({ id: z.string().trim().min(1).max(120), type: z.string().trim().min(1).max(80), label: z.string().trim().max(200).optional(), props: z.record(z.unknown()).default({}), styles: z.record(z.unknown()).optional(), animation: nodeAnimationSchema.optional(), children: z.array(builderNodeSchema).max(200).optional(), isHidden: z.boolean().optional(), isLocked: z.boolean().optional() }).strict())
export const builderPageSchema = z.object({ id: z.string().trim().min(1).max(120), slug: z.string().trim().min(1).max(240), title: z.string().trim().min(1).max(200), nodes: z.array(builderNodeSchema).max(200) }).strict()
const seoSchema = z.object({ canonicalUrl: z.string().max(2048).optional(), title: z.string().max(70).optional(), description: z.string().max(180).optional(), openGraph: z.object({ title: z.string().max(95).optional(), description: z.string().max(200).optional(), image: z.string().max(2048).optional() }).strict().optional(), robots: z.object({ index: z.boolean().optional(), follow: z.boolean().optional() }).strict().optional(), structuredData: z.object({ enabled: z.boolean().optional() }).strict().optional() }).strict().optional()
export const builderDocumentSchema = z.object({
  schemaVersion: z.literal(2),
  template: z.object({ id: z.enum(WEBSITE_TEMPLATE_IDS), version: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict(),
  seo: seoSchema,
  pages: z.array(builderPageSchema).min(1),
  theme: z.object({ primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0f172a'), secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2563eb'), accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#7c3aed'), fontFamily: z.string().trim().min(1).max(80).default('Inter') }).strict(),
}).strict()


const componentIdSchema = z.string().trim().min(1).max(120).regex(
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\.v[1-9]\d*$/,
  'Use a versioned component ID such as hero.split-luxury.v1',
)
const componentOverridesSchema = z.object({
  shared: z.object({ header: componentIdSchema.optional(), footer: componentIdSchema.optional() }).strict().optional(),
  home: z.object({
    hero: componentIdSchema.optional(),
    featuredProperties: componentIdSchema.optional(),
    whyChooseUs: componentIdSchema.optional(),
    reviews: componentIdSchema.optional(),
    agents: componentIdSchema.optional(),
    consultation: componentIdSchema.optional(),
  }).strict().optional(),
}).strict()
const componentAnimationSchema = z.object({
  enabled: z.boolean(),
  preset: z.enum(WEBSITE_ANIMATION_PRESETS),
  duration: z.enum(WEBSITE_ANIMATION_DURATIONS),
  delay: z.union([z.literal(0), z.literal(100), z.literal(200), z.literal(300), z.literal(500)]),
  trigger: z.enum(WEBSITE_ANIMATION_TRIGGERS),
  replay: z.boolean(),
}).strict()
const componentAnimationsSchema = z.object({
  shared: z.object({ header: componentAnimationSchema.optional(), footer: componentAnimationSchema.optional() }).strict().optional(),
  home: z.object({
    hero: componentAnimationSchema.optional(),
    featuredProperties: componentAnimationSchema.optional(),
    whyChooseUs: componentAnimationSchema.optional(),
    reviews: componentAnimationSchema.optional(),
    agents: componentAnimationSchema.optional(),
    consultation: componentAnimationSchema.optional(),
  }).strict().optional(),
}).strict()
const websiteDesignSchema = z.object({
  schemaVersion: z.literal(WEBSITE_DESIGN_SCHEMA_VERSION),
  componentOverrides: componentOverridesSchema,
  componentAnimations: componentAnimationsSchema,
  animationsEnabled: z.boolean(),
}).strict()
const expectedPublicationRevisionSchema = z.number().int().min(0).optional()
const designActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('SET_COMPONENT'), slot: z.enum(WEBSITE_COMPONENT_SLOTS), componentId: componentIdSchema, expectedPublicationRevision: expectedPublicationRevisionSchema }).strict(),
  z.object({ action: z.literal('RESET_COMPONENT'), slot: z.enum(WEBSITE_COMPONENT_SLOTS), expectedPublicationRevision: expectedPublicationRevisionSchema }).strict(),
  z.object({ action: z.literal('RESET_ALL_COMPONENTS'), expectedPublicationRevision: expectedPublicationRevisionSchema }).strict(),
  z.object({ action: z.literal('SET_ANIMATION'), slot: z.enum(WEBSITE_COMPONENT_SLOTS), animation: componentAnimationSchema, expectedPublicationRevision: expectedPublicationRevisionSchema }).strict(),
  z.object({ action: z.literal('RESET_ANIMATION'), slot: z.enum(WEBSITE_COMPONENT_SLOTS), expectedPublicationRevision: expectedPublicationRevisionSchema }).strict(),
  z.object({ action: z.literal('RESET_ALL_ANIMATIONS'), expectedPublicationRevision: expectedPublicationRevisionSchema }).strict(),
  z.object({ action: z.literal('SET_ANIMATIONS_ENABLED'), enabled: z.boolean(), expectedPublicationRevision: expectedPublicationRevisionSchema }).strict(),
  z.object({ action: z.literal('APPLY_TEMPLATE'), templateId: z.enum(WEBSITE_TEMPLATE_IDS), resetComponents: z.boolean().optional(), keepAnimations: z.boolean().optional(), expectedPublicationRevision: expectedPublicationRevisionSchema }).strict(),
  z.object({ action: z.literal('APPLY_DESIGN'), design: websiteDesignSchema, templateId: z.enum(WEBSITE_TEMPLATE_IDS).optional(), expectedPublicationRevision: expectedPublicationRevisionSchema }).strict(),
])

export function checkGuardrails(document: any): { valid: boolean; message?: string } {
  if (!document || !Array.isArray(document.pages)) return { valid: false, message: 'Invalid document structure' }
  let totalNodes = 0; let maxDepth = 0
  function walk(nodes: any[], depth: number) { maxDepth = Math.max(maxDepth, depth); for (const node of nodes) { totalNodes += 1; if (Array.isArray(node.children)) walk(node.children, depth + 1) } }
  for (const page of document.pages) if (Array.isArray(page.nodes)) walk(page.nodes, 1)
  if (maxDepth > 10) return { valid: false, message: `Tree depth exceeded limit of 10 (found depth ${maxDepth})` }
  if (totalNodes > 200) return { valid: false, message: `Total node count exceeded limit of 200 (found ${totalNodes} nodes)` }
  return { valid: true }
}


const mongoIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/)
const pageParamsSchema = z.object({ id: mongoIdSchema }).strict()
const revisionParamsSchema = z.object({ id: mongoIdSchema, version: z.coerce.number().int().positive().max(1_000_000) }).strict()
const publicIdentifierParamsSchema = z.object({ identifier: z.string().trim().min(1).max(255) }).strict()

export const WebsiteBuilderValidation = {
  builderDocumentSchema, checkGuardrails,
  pageParamsSchema: z.object({ params: pageParamsSchema }),
  revisionParamsSchema: z.object({ params: revisionParamsSchema }),
  publicIdentifierParamsSchema: z.object({ params: publicIdentifierParamsSchema }),
  designActionSchema: z.object({ body: designActionSchema }),
  saveDraftSchema: z.object({ body: z.object({ document: z.record(z.unknown()) }).strict() }),
  scheduleSchema: z.object({ body: z.object({ publishAt: z.string().datetime() }).strict() }),
  presignAssetSchema: z.object({ body: z.object({ filename: z.string().trim().min(1).max(255).refine((value) => !/[\/\\\u0000]/.test(value), 'Invalid filename'), mimeType: z.enum(['image/jpeg','image/png','image/webp','image/avif','font/woff2']), size: z.number().int().positive().max(20 * 1024 * 1024) }).strict() }),
  importAssetUrlSchema: z.object({ body: z.object({ url: z.string().url().max(2048).refine((value) => { try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password } catch { return false } }, 'URL must use HTTP(S) without embedded credentials'), altText: z.string().max(300).optional() }).strict() }),
  completeAssetSchema: z.object({ body: z.object({ key: z.string().trim().min(1).max(1024).refine((value) => !value.includes('\\') && !value.split('/').includes('..') && !value.startsWith('/'), 'Invalid storage key'), originalName: z.string().trim().max(255).refine((value) => !/[\/\\\u0000]/.test(value), 'Invalid filename').optional(), mimeType: z.enum(['image/jpeg','image/png','image/webp','image/avif','font/woff2']), width: z.number().int().positive().max(20_000).optional(), height: z.number().int().positive().max(20_000).optional(), altText: z.string().max(300).optional(), variants: z.array(z.object({ key: z.string().trim().min(1).max(1200).refine((value) => !value.includes('\\') && !value.split('/').includes('..') && !value.startsWith('/'), 'Invalid storage key'), format: z.enum(['webp','avif']), width: z.number().int().positive().max(20_000), height: z.number().int().positive().max(20_000).optional() }).strict()).max(8).optional() }).strict() }),
}
