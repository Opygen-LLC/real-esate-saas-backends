import { z } from 'zod'
import { PAID_PLAN_ID_MAX_LENGTH, PAID_PLAN_ID_MIN_LENGTH, PAID_PLAN_ID_PATTERN } from './planIdentity'

const nonNegativeInteger = z.number().int().nonnegative()
const tierRankInput = z.number().int().min(0).max(100000)
const maxTeamMembers = nonNegativeInteger

export const paidPlanIdSchema = z.string()
  .trim()
  .toLowerCase()
  .min(PAID_PLAN_ID_MIN_LENGTH)
  .max(PAID_PLAN_ID_MAX_LENGTH)
  .regex(PAID_PLAN_ID_PATTERN, 'Plan ID must be a lowercase slug containing only letters, numbers, and hyphens')
  .refine((value) => value !== 'trial', 'The plan ID "trial" is reserved')

const planLimitEntitlementInput = z.object({ enabled: z.boolean(), limit: nonNegativeInteger }).strict()
const planBooleanEntitlementInput = z.object({ enabled: z.boolean(), limit: z.never().optional() }).strict()

// Lead capacity is intentionally absent here. baseLeadCapacity is the only legal
// source for lead capacity on Phase 5 plan writes; the server derives entitlements.leads.
const planEntitlementsInput = z.object({
  leads: z.never().optional(),
  properties: planLimitEntitlementInput.optional(),
  teamMembers: planLimitEntitlementInput.optional(),
  storage: planLimitEntitlementInput.optional(),
  monthlyVisitors: planLimitEntitlementInput.optional(),
  customDomain: planBooleanEntitlementInput.optional(),
  advancedAnalytics: planBooleanEntitlementInput.optional(),
  whatsappIntegration: planBooleanEntitlementInput.optional(),
  smsAutomation: planBooleanEntitlementInput.optional(),
  leadAutomations: planBooleanEntitlementInput.optional(),
  premiumTemplates: planBooleanEntitlementInput.optional(),
}).strict()

// These fields remain readable on historical immutable plan versions, but they
// are no longer legal inputs for a plan family or new plan version.
const forbiddenLegacyWriteFields = {
  displayOrder: z.never().optional(),
  upgradeRank: z.never().optional(),
  maxLeads: z.never().optional(),
  maxRecurringLeadAddon: z.never().optional(),
  leadPolicyVersion: z.never().optional(),
  leadAllowanceModel: z.never().optional(),
  baseMonthlyLeadAllowance: z.never().optional(),
  renewalLeadBonus: z.never().optional(),
  renewalBonusEnabled: z.never().optional(),
  maxRenewalLeadBonus: z.never().optional(),
  continuityGraceDays: z.never().optional(),
}

const forbiddenLifecycleCreateFields = {
  status: z.never().optional(),
  isActive: z.never().optional(),
  isCurrent: z.never().optional(),
  grandfatherExisting: z.never().optional(),
  effectiveFrom: z.never().optional(),
  effectiveTo: z.never().optional(),
  migrationAppliedAt: z.never().optional(),
}

const commercialCreateShape = {
  name: z.string().trim().min(2).max(80),
  tierRank: tierRankInput,
  priceMonthly: z.number().nonnegative(),
  priceYearly: z.number().nonnegative(),
  currency: z.literal('BDT'),
  description: z.string().max(1000).default(''),
  features: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  entitlements: planEntitlementsInput.optional(),
  maxTeamMembers,
  maxAgents: z.never().optional(),
  maxProperties: nonNegativeInteger,
  baseLeadCapacity: nonNegativeInteger,
  maxAddonLeadCapacity: nonNegativeInteger.nullable().default(0),
  hasCustomDomain: z.boolean().default(false),
  hasAdvancedAnalytics: z.boolean().default(false),
  hasWhatsAppIntegration: z.boolean().default(false),
  hasLeadAutomations: z.boolean().default(false),
  hasSmsAutomation: z.boolean().default(false),
  hasPremiumTemplates: z.boolean().default(false),
  maxStorageMb: nonNegativeInteger.default(1024),
  maxMonthlyVisitors: nonNegativeInteger.default(10000),
  isPopular: z.boolean().default(false),
  ...forbiddenLegacyWriteFields,
}

const normalizeTeamMembers = <T extends Record<string, any>>(value: T) => {
  const { maxTeamMembers: teamMembers, ...rest } = value
  return {
    ...rest,
    ...(teamMembers !== undefined ? { maxAgents: teamMembers } : {}),
  }
}

const createBody = z.object({
  ...commercialCreateShape,
  ...forbiddenLifecycleCreateFields,
  planId: paidPlanIdSchema,
  changeReason: z.string().trim().min(10).max(500),
}).transform(normalizeTeamMembers)

const updateBody = z.object({
  planId: z.never().optional(),
  ...forbiddenLifecycleCreateFields,
  ...forbiddenLegacyWriteFields,
  name: commercialCreateShape.name.optional(),
  tierRank: tierRankInput.optional(),
  priceMonthly: commercialCreateShape.priceMonthly.optional(),
  priceYearly: commercialCreateShape.priceYearly.optional(),
  currency: commercialCreateShape.currency.optional(),
  description: z.string().max(1000).optional(),
  features: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  entitlements: planEntitlementsInput.partial().optional(),
  maxTeamMembers: maxTeamMembers.optional(),
  maxAgents: z.never().optional(),
  maxProperties: nonNegativeInteger.optional(),
  baseLeadCapacity: nonNegativeInteger.optional(),
  maxAddonLeadCapacity: nonNegativeInteger.nullable().optional(),
  hasCustomDomain: z.boolean().optional(),
  hasAdvancedAnalytics: z.boolean().optional(),
  hasWhatsAppIntegration: z.boolean().optional(),
  hasLeadAutomations: z.boolean().optional(),
  hasSmsAutomation: z.boolean().optional(),
  hasPremiumTemplates: z.boolean().optional(),
  maxStorageMb: nonNegativeInteger.optional(),
  maxMonthlyVisitors: nonNegativeInteger.optional(),
  isPopular: z.boolean().optional(),
  changeReason: z.string().trim().min(10).max(500),
}).superRefine((value, ctx) => {
  if (!Object.keys(value).some((key) => key !== 'changeReason')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one commercial plan field must change' })
  }
}).transform(normalizeTeamMembers)

export const SubscriptionPlanValidation = {
  create: z.object({ body: createBody }),
  update: z.object({ body: updateBody }),
  archive: z.object({ body: z.object({ reason: z.string().trim().min(10).max(500) }) }),
}
