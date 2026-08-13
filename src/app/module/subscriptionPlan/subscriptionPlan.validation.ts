import { z } from 'zod'

const commercialFields = z.object({
  name: z.string().trim().min(2).max(80),
  priceMonthly: z.number().nonnegative(),
  priceYearly: z.number().nonnegative(),
  currency: z.literal('BDT'),
  description: z.string().max(1000).default(''),
  features: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  maxAgents: z.number().int().nonnegative(),
  maxProperties: z.number().int().nonnegative(),
  maxLeads: z.number().int().nonnegative(),
  hasCustomDomain: z.boolean().default(false),
  hasAdvancedAnalytics: z.boolean().default(false),
  hasWhatsAppIntegration: z.boolean().default(false),
  hasLeadAutomations: z.boolean().default(false),
  hasSmsAutomation: z.boolean().default(false),
  hasPremiumTemplates: z.boolean().default(false),
  maxStorageMb: z.number().int().nonnegative().default(1024),
  maxMonthlyVisitors: z.number().int().nonnegative().default(10000),
  isPopular: z.boolean().default(false),
  isActive: z.boolean().default(true),
})

export const SubscriptionPlanValidation = {
  create: z.object({ body: commercialFields.extend({
    planId: z.enum(['starter', 'professional', 'agency', 'enterprise']),
    effectiveFrom: z.coerce.date().optional(),
    grandfatherExisting: z.boolean().default(true),
    changeReason: z.string().trim().min(10).max(500),
  }) }),
  update: z.object({ body: commercialFields.partial().extend({
    effectiveFrom: z.coerce.date().optional(),
    grandfatherExisting: z.boolean().optional(),
    changeReason: z.string().trim().min(10).max(500),
  }).refine((value) => Object.keys(value).some((key) => !['changeReason'].includes(key)), {
    message: 'At least one plan field must change',
  }) }),
  archive: z.object({ body: z.object({ reason: z.string().trim().min(10).max(500) }) }),
}
