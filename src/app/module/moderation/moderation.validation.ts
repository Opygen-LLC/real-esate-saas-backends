import { z } from 'zod'
export const ModerationValidation = {
  report: z.object({ body: z.object({
    organizationId: z.string().trim().min(3).max(80), propertyId: z.string().regex(/^[0-9a-fA-F]{24}$/),
    reporterName: z.string().trim().max(100).optional(), reporterEmail: z.union([z.literal(''), z.string().email().max(160)]).optional(),
    reporterPhone: z.string().trim().max(30).optional(),
    category: z.enum(['fake_listing', 'wrong_information', 'duplicate', 'fraud_attempt', 'other']),
    details: z.string().trim().min(20).max(2000),
  }).strict() }),
  listing: z.object({ body: z.object({ status: z.enum(['approved', 'rejected', 'flagged']), reason: z.string().trim().min(10).max(500) }).strict() }),
  reportReview: z.object({ body: z.object({ status: z.enum(['investigating', 'resolved', 'dismissed']), reason: z.string().trim().min(10).max(500) }).strict() }),
}
