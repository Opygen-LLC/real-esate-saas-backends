import { z } from 'zod'
import { normalizeEntitlementWrite } from '../entitlement/featureCatalog'

const safeUrl = z.union([z.literal(''), z.string().trim().url().max(2048)])
const bdPhone = z.union([z.literal(''), z.string().trim().regex(/^\+8801[3-9]\d{8}$/, 'Use Bangladesh format +8801XXXXXXXXX')])
const safeEmail = z.union([z.literal(''), z.string().trim().email().max(254).transform(value => value.toLowerCase())])

const limitEntitlementInput = z.object({ enabled: z.literal(true), limit: z.number().int().min(1) }).strict()
const booleanEntitlementInput = z.object({ enabled: z.boolean(), limit: z.never().optional() }).strict()
const trialEntitlementsInput = z.object({
  leads: limitEntitlementInput.optional(),
  properties: limitEntitlementInput.optional(),
  teamMembers: limitEntitlementInput.optional(),
  storage: limitEntitlementInput.optional(),
  monthlyVisitors: limitEntitlementInput.optional(),
  customDomain: booleanEntitlementInput.optional(),
  advancedAnalytics: booleanEntitlementInput.optional(),
  whatsappIntegration: booleanEntitlementInput.optional(),
  smsAutomation: booleanEntitlementInput.optional(),
  leadAutomations: booleanEntitlementInput.optional(),
  premiumTemplates: booleanEntitlementInput.optional(),
}).strict().optional()
const trialPolicyInput = z.object({
  enabled: z.boolean(),
  defaultTrialDays: z.number().int().min(0).max(365),
  gracePeriodDays: z.number().int().min(0).max(60).optional(),
  trialGraceDays: z.number().int().min(0).max(60).optional(),
  paidRenewalGraceDays: z.number().int().min(0).max(60).default(0),
  reminderDaysBeforeExpiry: z.number().int().min(0).max(60),
  entitlements: trialEntitlementsInput,
  maxTeamMembers: z.number().int().min(1).max(9999).optional(),
  // Transitional alias accepted for older clients; persistence remains maxAgents until the schema migration phase.
  maxAgents: z.number().int().min(1).max(9999).optional(),
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
}).superRefine((value, ctx) => {
  if (value.maxTeamMembers === undefined && value.maxAgents === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxTeamMembers'], message: 'Team member limit is required' })
  }
  if (value.maxTeamMembers !== undefined && value.maxAgents !== undefined && value.maxTeamMembers !== value.maxAgents) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxTeamMembers'], message: 'Conflicting team member limits were supplied' })
  }
  if (value.trialGraceDays === undefined && value.gracePeriodDays === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['trialGraceDays'], message: 'Trial grace days are required' })
  }
}).transform(({ maxTeamMembers, maxAgents, entitlements, trialGraceDays, gracePeriodDays, paidRenewalGraceDays, ...rest }) => {
  const normalizedTrialGraceDays = trialGraceDays ?? gracePeriodDays ?? 0
  return normalizeEntitlementWrite({
    ...rest,
    maxAgents: maxTeamMembers ?? maxAgents,
    gracePeriodDays: normalizedTrialGraceDays, // backward-compatible persistence alias
    trialGraceDays: normalizedTrialGraceDays,
    paidRenewalGraceDays,
  }, entitlements)
})

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
    }).superRefine((privacy, ctx) => {
      if (privacy.legalReviewStatus !== 'approved') return
      if (!privacy.policyUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['policyUrl'], message: 'Policy URL is required before privacy can be approved' })
      if (!privacy.policyVersion) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['policyVersion'], message: 'Policy version is required before privacy can be approved' })
    }).optional(),
    authentication: z.object({
      requireEmailOtpVerification: z.boolean(),
    }).strict().optional(),
    support: z.object({
      whatsapp: bdPhone,
      phone: bdPhone,
      email: safeEmail,
      facebook: safeUrl,
      messenger: safeUrl,
      instagram: safeUrl,
      linkedin: safeUrl,
      youtube: safeUrl,
      website: safeUrl,
    }).strict().optional(),
    trial: trialPolicyInput.optional(),
    areaConversion: z.object({
      kathaSqft: z.number().positive().max(10000),
      bighaKatha: z.number().positive().max(100),
      note: z.string().trim().max(300),
    }).optional(),
  }).strict() }),
}
