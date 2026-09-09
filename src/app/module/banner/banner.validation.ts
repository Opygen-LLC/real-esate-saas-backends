import { z } from 'zod'

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid banner id')

const safeUrl = (options: { allowRelative?: boolean; allowContactSchemes?: boolean } = {}) =>
  z.string().trim().max(2048).refine((value) => {
    if (!value) return true
    if (options.allowRelative && (value.startsWith('/') || value.startsWith('#'))) {
      return !value.startsWith('//') && !/[\u0000-\u001F\u007F]/.test(value)
    }
    try {
      const parsed = new URL(value)
      const allowed = options.allowContactSchemes
        ? ['http:', 'https:', 'mailto:', 'tel:']
        : ['http:', 'https:']
      return allowed.includes(parsed.protocol) && !parsed.username && !parsed.password
    } catch {
      return false
    }
  }, 'URL must use an allowed protocol')

const body = z.object({
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().max(500).optional(),
  image: safeUrl({ allowRelative: true }).refine(Boolean, 'Image is required'),
  link: safeUrl({ allowRelative: true, allowContactSchemes: true }).optional(),
  btnText: z.string().trim().max(80).optional(),
  status: z.boolean().optional(),
}).strict()

const create = z.object({ body })
const update = z.object({
  params: z.object({ id: objectId }).strict(),
  body: body.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required'),
})
const remove = z.object({ params: z.object({ id: objectId }).strict() })

export const BannerValidation = { create, update, remove }
