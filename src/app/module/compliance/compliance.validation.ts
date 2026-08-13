import { z } from 'zod'

const documentValue = z.string().trim().min(4).max(80)
export const ComplianceValidation = {
  profile: z.object({ body: z.object({
    requiredDocuments: z.array(z.enum(['nid', 'trade_license', 'tin', 'bin'])).max(4),
    nid: documentValue.optional(), tradeLicense: documentValue.optional(),
    tin: documentValue.optional(), bin: documentValue.optional(),
  }).strict() }),
  consent: z.object({ body: z.object({
    purpose: z.enum(['service_terms', 'privacy_policy', 'marketing']),
    policyVersion: z.string().trim().min(1).max(80), granted: z.boolean(),
  }).strict() }),
  request: z.object({ body: z.object({
    type: z.enum(['export', 'deletion']), requestReason: z.string().trim().max(500).optional(),
  }).strict() }),
  reviewProfile: z.object({ body: z.object({
    status: z.enum(['in_review', 'verified', 'rejected', 'suspended']),
    reason: z.string().trim().min(10).max(500),
  }).strict() }),
  processRequest: z.object({ body: z.object({
    status: z.enum(['in_review', 'approved', 'completed', 'rejected']),
    reason: z.string().trim().min(10).max(500),
  }).strict() }),
}
