import { z } from 'zod'

const safeUrl = z.union([z.literal(''), z.string().url().max(2048)])
export const PlatformSettingsValidation = {
  update: z.object({ body: z.object({
    reason: z.string().trim().min(10).max(500),
    tax: z.object({
      invoiceEnabled: z.boolean(),
      registrationStatus: z.enum(['not_registered', 'registered']),
      operatorLegalName: z.string().trim().max(160),
      bin: z.string().trim().max(20),
      vatRate: z.number().min(0).max(100),
      pricesIncludeVat: z.boolean(),
    }).optional(),
    privacy: z.object({
      policyUrl: safeUrl,
      policyVersion: z.string().trim().max(80),
      retentionDays: z.number().int().min(30).max(3650),
      legalReviewStatus: z.enum(['required', 'approved']),
    }).optional(),
    areaConversion: z.object({
      kathaSqft: z.number().positive().max(10000),
      bighaKatha: z.number().positive().max(100),
      note: z.string().trim().max(300),
    }).optional(),
  }).strict() }),
}
