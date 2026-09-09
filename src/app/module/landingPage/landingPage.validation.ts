import { z } from 'zod'

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid landing page id')
const slug = z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug may contain lowercase letters, numbers and hyphens only')

const body = z.object({
  title: z.string().trim().min(1).max(160),
  slug,
  content: z.string().max(100_000).optional(),
  metaTitle: z.string().trim().max(120).optional(),
  metaDescription: z.string().trim().max(320).optional(),
  status: z.boolean().optional(),
}).strict()

const create = z.object({ body })
const update = z.object({
  params: z.object({ id: objectId }).strict(),
  body: body.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required'),
})
const remove = z.object({ params: z.object({ id: objectId }).strict() })

export const LandingPageValidation = { create, update, remove }
