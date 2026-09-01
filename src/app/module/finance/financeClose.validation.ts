import { z } from 'zod'
const objectId = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Must be a valid ObjectId')
const reason = z.string().trim().min(10).max(1000)
export const FinanceCloseValidation = {
  id: z.object({ params: z.object({ id: objectId }) }),
  close: z.object({ params: z.object({ id: objectId }), body: z.object({ reason }).strict() }),
  reopen: z.object({ params: z.object({ id: objectId }), body: z.object({ reason }).strict() }),
  audit: z.object({ query: z.object({ page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional(), action: z.string().trim().max(120).optional() }).passthrough() }),
}
