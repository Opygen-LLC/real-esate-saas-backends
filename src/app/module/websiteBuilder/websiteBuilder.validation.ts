import { z } from 'zod'

export const nodeAnimationSchema = z.object({
  name: z.enum(['none','fade-in','fade-up','fade-down','fade-left','fade-right','zoom-in','slide-up','blur-in']),
  duration: z.number().min(0).max(10000).default(600), delay: z.number().min(0).max(10000).default(0),
  easing: z.enum(['linear','ease','ease-in','ease-out','ease-in-out']).default('ease-out'), trigger: z.enum(['onload','onviewport']).default('onload'),
})
export const builderNodeSchema: z.ZodType<any> = z.lazy(() => z.object({ id: z.string().min(1), type: z.string().min(1), label: z.string().optional(), props: z.record(z.any()).default({}), styles: z.record(z.any()).optional(), animation: nodeAnimationSchema.optional(), children: z.array(builderNodeSchema).optional(), isHidden: z.boolean().optional(), isLocked: z.boolean().optional() }))
export const builderPageSchema = z.object({ id: z.string().min(1), slug: z.string().min(1), title: z.string().min(1), nodes: z.array(builderNodeSchema) })
const seoSchema = z.object({ canonicalUrl: z.string().max(2048).optional(), title: z.string().max(70).optional(), description: z.string().max(180).optional(), openGraph: z.object({ title: z.string().max(95).optional(), description: z.string().max(200).optional(), image: z.string().max(2048).optional() }).optional(), robots: z.object({ index: z.boolean().optional(), follow: z.boolean().optional() }).optional(), structuredData: z.object({ enabled: z.boolean().optional() }).optional() }).optional()
export const builderDocumentSchema = z.object({
  schemaVersion: z.literal(2),
  template: z.object({ id: z.enum(['template-1','template-2','template-3','template-4']), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  seo: seoSchema,
  pages: z.array(builderPageSchema).min(1),
  theme: z.object({ primaryColor: z.string().default('#0f172a'), secondaryColor: z.string().default('#2563eb'), accentColor: z.string().default('#7c3aed'), fontFamily: z.string().default('Inter') }),
}).passthrough()

export function checkGuardrails(document: any): { valid: boolean; message?: string } {
  if (!document || !Array.isArray(document.pages)) return { valid: false, message: 'Invalid document structure' }
  let totalNodes = 0; let maxDepth = 0
  function walk(nodes: any[], depth: number) { maxDepth = Math.max(maxDepth, depth); for (const node of nodes) { totalNodes += 1; if (Array.isArray(node.children)) walk(node.children, depth + 1) } }
  for (const page of document.pages) if (Array.isArray(page.nodes)) walk(page.nodes, 1)
  if (maxDepth > 10) return { valid: false, message: `Tree depth exceeded limit of 10 (found depth ${maxDepth})` }
  if (totalNodes > 200) return { valid: false, message: `Total node count exceeded limit of 200 (found ${totalNodes} nodes)` }
  return { valid: true }
}

export const WebsiteBuilderValidation = {
  builderDocumentSchema, checkGuardrails,
  saveDraftSchema: z.object({ body: z.object({ document: z.record(z.any()) }) }),
  scheduleSchema: z.object({ body: z.object({ publishAt: z.string().datetime() }) }),
  presignAssetSchema: z.object({ body: z.object({ filename: z.string().min(1).max(255), mimeType: z.enum(['image/jpeg','image/png','image/webp','image/avif','font/woff2']), size: z.number().int().positive().max(20 * 1024 * 1024) }) }),
  importAssetUrlSchema: z.object({ body: z.object({ url: z.string().url().max(2048), altText: z.string().max(300).optional() }) }),
  completeAssetSchema: z.object({ body: z.object({ key: z.string().min(1).max(1024), originalName: z.string().max(255).optional(), mimeType: z.enum(['image/jpeg','image/png','image/webp','image/avif','font/woff2']), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), altText: z.string().max(300).optional(), variants: z.array(z.object({ key: z.string().min(1).max(1200), format: z.enum(['webp','avif']), width: z.number().int().positive(), height: z.number().int().positive().optional() })).max(8).optional() }) }),
}
