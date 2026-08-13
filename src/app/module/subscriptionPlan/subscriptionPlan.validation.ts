import { z } from 'zod'
const fields = z.object({ planId: z.enum(['starter', 'professional', 'agency', 'enterprise']), name: z.string().trim().min(2).max(80),
  priceMonthly: z.number().nonnegative(), priceYearly: z.number().nonnegative(), currency: z.literal('BDT'), description: z.string().max(1000).default(''),
  features: z.array(z.string().max(120)).max(50).default([]), maxAgents: z.number().int().nonnegative(), maxProperties: z.number().int().nonnegative(),
  maxLeads: z.number().int().nonnegative(), hasCustomDomain: z.boolean().default(false), hasAdvancedAnalytics: z.boolean().default(false), hasWhatsAppIntegration: z.boolean().default(false),
  hasLeadAutomations: z.boolean().default(false), hasSmsAutomation: z.boolean().default(false), hasPremiumTemplates: z.boolean().default(false), maxStorageMb: z.number().int().nonnegative().default(1024),
  maxMonthlyVisitors: z.number().int().nonnegative().default(10000), isPopular: z.boolean().default(false), isActive: z.boolean().default(true) })
export const SubscriptionPlanValidation = { create: z.object({ body: fields }), update: z.object({ body: fields.partial().omit({ planId: true }) }) }
