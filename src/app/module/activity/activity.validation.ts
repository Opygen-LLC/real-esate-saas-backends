import { z } from 'zod'
import { objectIdSchema, paginationQuerySchema } from '../../helpers/inputSecurity'

const userActivityType = z.enum(['call', 'email', 'whatsapp', 'meeting', 'note', 'offer'])

const createActivityZodSchema = z.object({
  body: z.object({
    leadId: objectIdSchema,
    propertyId: objectIdSchema.optional(),
    contactId: objectIdSchema.optional(),
    type: userActivityType.optional(),
    title: z.string().trim().max(180).optional(),
    content: z.string().trim().max(10_000).optional(),
    metadata: z.record(z.unknown()).optional(),
  }).strict(),
})

const activityListQuery = paginationQuerySchema.extend({
  sortBy: z.literal('createdAt').optional(),
}).strict()

const getActivitiesByLeadZodSchema = z.object({
  params: z.object({ leadId: objectIdSchema }).strict(),
  query: activityListQuery,
})

const appendNoteZodSchema = z.object({
  body: z.object({
    content: z.string().trim().min(1, 'Note content is required').max(10000),
  }).strict(),
})

export const ActivityValidation = {
  createActivityZodSchema,
  getActivitiesByLeadZodSchema,
  appendNoteZodSchema,
}
