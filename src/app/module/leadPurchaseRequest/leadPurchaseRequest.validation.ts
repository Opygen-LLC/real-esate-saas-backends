import { z } from 'zod'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/)

export const LeadPurchaseRequestValidation = {
  create: z.object({ body: z.object({
    pricingRuleId: objectId,
    requestedLeads: z.number().int().min(1).max(10000000),
  }).strict() }),
  cancel: z.object({ params: z.object({ id: objectId }) }),
  adminList: z.object({ query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().trim().max(200).optional(),
    status: z.enum(['all', 'pending', 'approved', 'rejected', 'cancelled']).optional(),
  }) }),
  decision: z.object({
    params: z.object({ id: objectId }),
    body: z.discriminatedUnion('status', [
      z.object({ status: z.literal('approved'), reason: z.string().trim().min(10).max(500) }).strict(),
      z.object({ status: z.literal('rejected'), reason: z.string().trim().min(10).max(500) }).strict(),
    ]),
  }),
}
