import { z } from 'zod'
import { PAID_PLAN_ID_MAX_LENGTH, PAID_PLAN_ID_MIN_LENGTH, PAID_PLAN_ID_PATTERN } from './planIdentity'

const maxTeamMembers = z.number().int().nonnegative()
const legacyMaxAgents = z.number().int().nonnegative()

export const paidPlanIdSchema = z.string()
  .trim()
  .toLowerCase()
  .min(PAID_PLAN_ID_MIN_LENGTH)
  .max(PAID_PLAN_ID_MAX_LENGTH)
  .regex(PAID_PLAN_ID_PATTERN, 'Plan ID must be a lowercase slug containing only letters, numbers, and hyphens')
  .refine((value) => value !== 'trial', 'The plan ID "trial" is reserved')

const planLimitEntitlementInput = z.object({ enabled: z.boolean(), limit: z.number().int().nonnegative() }).strict()
const planBooleanEntitlementInput = z.object({ enabled: z.boolean(), limit: z.never().optional() }).strict()
const planEntitlementsInput = z.object({
  leads: planLimitEntitlementInput.optional(),
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

const commercialShape = {
  name: z.string().trim().min(2).max(80),
  displayOrder: z.number().int().min(0).max(100000),
  upgradeRank: z.number().int().min(0).max(100000),
  priceMonthly: z.number().nonnegative(),
  priceYearly: z.number().nonnegative(),
  currency: z.literal('BDT'),
  description: z.string().max(1000).default(''),
  features: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  entitlements: planEntitlementsInput.optional(),
  maxTeamMembers: maxTeamMembers.optional(),
  // Transitional input alias for older dashboard builds. Parsed payloads are normalized to maxAgents for persistence.
  maxAgents: legacyMaxAgents.optional(),
  maxProperties: z.number().int().nonnegative(),
  maxLeads: z.number().int().nonnegative(),
  leadAllowanceModel: z.enum(['paid_period_credits', 'active_capacity']).default('paid_period_credits'),
  baseMonthlyLeadAllowance: z.number().int().nonnegative(),
  renewalLeadBonus: z.number().int().nonnegative(),
  renewalBonusEnabled: z.boolean(),
  maxRenewalLeadBonus: z.number().int().nonnegative(),
  continuityGraceDays: z.number().int().min(0).max(31),
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
}

const normalizeTeamMemberLimit = <T extends Record<string, unknown>>(value: T) => {
  const { maxTeamMembers: canonical, maxAgents: legacy, ...rest } = value
  return { ...rest, maxAgents: canonical ?? legacy }
}

const requireTeamMemberLimit = (value: { maxTeamMembers?: number; maxAgents?: number }, ctx: z.RefinementCtx) => {
  if (value.maxTeamMembers === undefined && value.maxAgents === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxTeamMembers'], message: 'Team member limit is required' })
    return
  }
  if (value.maxTeamMembers !== undefined && value.maxAgents !== undefined && value.maxTeamMembers !== value.maxAgents) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxTeamMembers'], message: 'Conflicting team member limits were supplied' })
  }
}

const createBody = z.object({
  ...commercialShape,
  planId: paidPlanIdSchema,
  effectiveFrom: z.coerce.date().optional(),
  grandfatherExisting: z.boolean().default(true),
  changeReason: z.string().trim().min(10).max(500),
}).superRefine(requireTeamMemberLimit).transform(normalizeTeamMemberLimit)

const updateBody = z.object({
  name: commercialShape.name.optional(),
  displayOrder: commercialShape.displayOrder.optional(),
  upgradeRank: commercialShape.upgradeRank.optional(),
  priceMonthly: commercialShape.priceMonthly.optional(),
  priceYearly: commercialShape.priceYearly.optional(),
  currency: commercialShape.currency.optional(),
  description: z.string().max(1000).optional(),
  features: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  entitlements: planEntitlementsInput.partial().optional(),
  maxTeamMembers: maxTeamMembers.optional(),
  maxAgents: legacyMaxAgents.optional(),
  maxProperties: commercialShape.maxProperties.optional(),
  maxLeads: commercialShape.maxLeads.optional(),
  leadAllowanceModel: commercialShape.leadAllowanceModel.optional(),
  baseMonthlyLeadAllowance: commercialShape.baseMonthlyLeadAllowance.optional(),
  renewalLeadBonus: commercialShape.renewalLeadBonus.optional(),
  renewalBonusEnabled: commercialShape.renewalBonusEnabled.optional(),
  maxRenewalLeadBonus: commercialShape.maxRenewalLeadBonus.optional(),
  continuityGraceDays: commercialShape.continuityGraceDays.optional(),
  hasCustomDomain: z.boolean().optional(),
  hasAdvancedAnalytics: z.boolean().optional(),
  hasWhatsAppIntegration: z.boolean().optional(),
  hasLeadAutomations: z.boolean().optional(),
  hasSmsAutomation: z.boolean().optional(),
  hasPremiumTemplates: z.boolean().optional(),
  maxStorageMb: z.number().int().nonnegative().optional(),
  maxMonthlyVisitors: z.number().int().nonnegative().optional(),
  isPopular: z.boolean().optional(),
  isActive: z.boolean().optional(),
  effectiveFrom: z.coerce.date().optional(),
  grandfatherExisting: z.boolean().optional(),
  changeReason: z.string().trim().min(10).max(500),
}).refine((value) => Object.keys(value).some((key) => key !== 'changeReason'), {
  message: 'At least one plan field must change',
}).transform(normalizeTeamMemberLimit)

export const SubscriptionPlanValidation = {
  create: z.object({ body: createBody }),
  update: z.object({ body: updateBody }),
  archive: z.object({ body: z.object({ reason: z.string().trim().min(10).max(500) }) }),
}
