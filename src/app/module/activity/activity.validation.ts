import { z } from 'zod'

const appendNoteZodSchema = z.object({
  body: z.object({
    content: z.string().trim().min(1, 'Note content is required').max(10000),
  }).strict(),
})

export const ActivityValidation = { appendNoteZodSchema }
