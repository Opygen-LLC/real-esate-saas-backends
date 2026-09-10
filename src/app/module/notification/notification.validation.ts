import { z } from 'zod'
import { cursorSchema, objectIdSchema, pageSizeSchema } from '../../helpers/inputSecurity'

export const NotificationValidation = {
  list: z.object({ query: z.object({ limit: pageSizeSchema.max(100).optional(), cursor: cursorSchema.optional() }).strict() }),
  id: z.object({ params: z.object({ id: objectIdSchema }).strict() }),
}
