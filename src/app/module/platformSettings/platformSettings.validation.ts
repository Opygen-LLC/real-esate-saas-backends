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
    trial: z.object({
      enabled: z.boolean(),
      defaultTrialDays: z.number().int().min(0).max(365),
      gracePeriodDays: z.number().int().min(0).max(60),
      reminderDaysBeforeExpiry: z.number().int().min(0).max(60),
      maxAgents: z.number().int().min(1).max(9999),
      maxProperties: z.number().int().min(1).max(999999),
      maxLeads: z.number().int().min(1).max(9999999),
      maxStorageMb: z.number().int().min(1).max(1048576),
      maxMonthlyVisitors: z.number().int().min(1).max(100000000),
      hasPremiumTemplates: z.boolean(),
      hasCustomDomain: z.boolean(),
      hasAdvancedAnalytics: z.boolean(),
      hasWhatsAppIntegration: z.boolean(),
      hasSmsAutomation: z.boolean(),
      hasLeadAutomations: z.boolean(),
    }).optional(),
    areaConversion: z.object({
      kathaSqft: z.number().positive().max(10000),
      bighaKatha: z.number().positive().max(100),
      note: z.string().trim().max(300),
    }).optional(),
  }).strict() }),
}
