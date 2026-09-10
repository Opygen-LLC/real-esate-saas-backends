import { z } from 'zod'
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/)
const statusQuery = z.object({ status: z.string().trim().min(1).max(40).optional() }).strict()
export const ModerationValidation = {
  report: z.object({ body: z.object({
    organizationId: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9_-]+$/), propertyId: objectId,
    reporterName: z.string().trim().max(100).optional(), reporterEmail: z.union([z.literal(''), z.string().email().max(160)]).optional(),
    reporterPhone: z.string().trim().max(30).optional(),
    category: z.enum(['fake_listing', 'wrong_information', 'duplicate', 'fraud_attempt', 'other']),
    details: z.string().trim().min(20).max(2000),
  }).strict() }),
  listingQueue: z.object({ query: statusQuery }),
  reportQueue: z.object({ query: statusQuery }),
  auditHistory: z.object({ query: z.object({ organizationId: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9_-]+$/).optional() }).strict() }),
  listing: z.object({ params: z.object({ id: objectId }).strict(), body: z.object({ status: z.enum(['approved', 'rejected', 'flagged']), reason: z.string().trim().min(10).max(500) }).strict() }),
  reportReview: z.object({ params: z.object({ id: objectId }).strict(), body: z.object({ status: z.enum(['investigating', 'resolved', 'dismissed']), reason: z.string().trim().min(10).max(500) }).strict() }),
}
