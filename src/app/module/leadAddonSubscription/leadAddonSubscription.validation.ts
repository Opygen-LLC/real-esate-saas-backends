import { z } from 'zod'
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/)
export const LeadAddonSubscriptionValidation = {
  quote: z.object({ body: z.object({ definitionId: objectId }) }),
  subscribe: z.object({ body: z.object({ definitionId: objectId, quoteCalculatedAt: z.string().datetime({ offset: true }).optional() }) }),
  id: z.object({ params: z.object({ id: objectId }) }),
  decision: z.object({ params: z.object({ id: objectId }), body: z.discriminatedUnion('status', [
    z.object({ status: z.literal('active'), method: z.enum(['cash', 'bank', 'bkash', 'nagad', 'other']), reference: z.string().trim().max(200).optional(), paidAt: z.string().datetime({ offset: true }).optional(), reason: z.string().trim().min(10).max(500) }),
    z.object({ status: z.literal('rejected'), reason: z.string().trim().min(10).max(500) }),
  ]) }),
}
