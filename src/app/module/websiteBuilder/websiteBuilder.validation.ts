import { z } from 'zod'

export const nodeAnimationSchema = z.object({
  name: z.enum([
    'none',
    'fade-in',
    'fade-up',
    'fade-down',
    'fade-left',
    'fade-right',
    'zoom-in',
    'slide-up',
    'blur-in',
  ]),
  duration: z.number().min(0).max(10000).default(600),
  delay: z.number().min(0).max(10000).default(0),
  easing: z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']).default('ease-out'),
  trigger: z.enum(['onload', 'onviewport']).default('onload'),
})

export const builderNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    label: z.string().optional(),
    props: z.record(z.any()).default({}),
    styles: z.record(z.any()).optional(),
    animation: nodeAnimationSchema.optional(),
    children: z.array(builderNodeSchema).optional(),
    isHidden: z.boolean().optional(),
    isLocked: z.boolean().optional(),
  })
)

export const builderPageSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  nodes: z.array(builderNodeSchema),
})

export const builderDocumentSchema = z.object({
  schemaVersion: z.number().int().min(1).default(1),
  pages: z.array(builderPageSchema).min(1),
  theme: z
    .object({
      primaryColor: z.string().default('#0f172a'),
      secondaryColor: z.string().default('#2563eb'),
      accentColor: z.string().default('#7c3aed'),
      fontFamily: z.string().default('Inter'),
    })
    .default({
      primaryColor: '#0f172a',
      secondaryColor: '#2563eb',
      accentColor: '#7c3aed',
      fontFamily: 'Inter',
    }),
})

// Helper functions for Section 3 Guardrail Checks
export function checkGuardrails(document: any): { valid: boolean; message?: string } {
  if (!document || !document.pages || !Array.isArray(document.pages)) {
    return { valid: false, message: 'Invalid document structure' }
  }

  let totalNodes = 0
  let maxDepth = 0

  function countAndMeasure(nodes: any[], depth: number) {
    if (depth > maxDepth) maxDepth = depth
    for (const n of nodes) {
      totalNodes++
      if (n.children && Array.isArray(n.children)) {
        countAndMeasure(n.children, depth + 1)
      }
    }
  }

  for (const page of document.pages) {
    if (page.nodes && Array.isArray(page.nodes)) {
      countAndMeasure(page.nodes, 1)
    }
  }

  // Guardrail 1: Max tree depth limit (10 levels)
  if (maxDepth > 10) {
    return { valid: false, message: `Tree depth exceeded limit of 10 (found depth ${maxDepth})` }
  }

  // Guardrail 2: Max node count per document (200 nodes)
  if (totalNodes > 200) {
    return { valid: false, message: `Total node count exceeded limit of 200 (found ${totalNodes} nodes)` }
  }

  return { valid: true }
}

export const WebsiteBuilderValidation = {
  builderDocumentSchema,
  checkGuardrails,
  saveDraftSchema: z.object({ body: z.object({ document: builderDocumentSchema.passthrough() }) }),
  assetSchema: z.object({ body: z.object({ key: z.string().trim().min(1).max(255), url: z.string().url().max(2048),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml', 'font/woff2']),
    size: z.number().int().min(0).max(20 * 1024 * 1024), width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(), altText: z.string().max(300).optional() }) }),
}
