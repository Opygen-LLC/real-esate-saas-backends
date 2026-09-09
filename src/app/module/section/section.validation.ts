import { z } from 'zod'

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid section id')
const SECTION_TYPES = ['PropertyGrid', 'PropertySearch', 'AgentList', 'Testimonials', 'ContactForm', 'CustomBanner'] as const
const dangerousKey = new Set(['__proto__', 'prototype', 'constructor'])

const isSafeStructuredContent = (value: unknown, depth = 0): boolean => {
  if (depth > 8) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') {
    if (value.length > 5_000) return false
    return !/(?:<\s*script\b|javascript\s*:|data\s*:\s*text\/html|on(?:error|load|click)\s*=)/i.test(value)
  }
  if (Array.isArray(value)) return value.length <= 100 && value.every((item) => isSafeStructuredContent(item, depth + 1))
  if (!value || typeof value !== 'object') return false
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 100) return false
  return entries.every(([key, child]) => !dangerousKey.has(key) && key.length <= 120 && isSafeStructuredContent(child, depth + 1))
}

const safeContent = z.record(z.unknown()).superRefine((value, ctx) => {
  if (!isSafeStructuredContent(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Section content contains unsupported or unsafe values' })
    return
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 50_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Section content is too large' })
  }
})

const body = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(SECTION_TYPES).optional(),
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  order: z.coerce.number().int().min(-1_000).max(1_000).optional(),
  status: z.boolean().optional(),
  content: safeContent.optional(),
}).strict()

const create = z.object({ body })
const update = z.object({
  params: z.object({ id: objectId }).strict(),
  body: body.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required'),
})
const remove = z.object({ params: z.object({ id: objectId }).strict() })

export const SectionValidation = { create, update, remove }
