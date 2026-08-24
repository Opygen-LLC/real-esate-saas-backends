import { z } from 'zod'
import { PAID_PLAN_ID_MAX_LENGTH, PAID_PLAN_ID_MIN_LENGTH, PAID_PLAN_ID_PATTERN } from './planIdentity'

const nonNegativeInteger = z.number().int().nonnegative()
const tierRankInput = z.number().int().min(0).max(100000)
const maxTeamMembers = nonNegativeInteger
const legacyMaxAgents = nonNegativeInteger

export const paidPlanIdSchema = z.string()
  .trim()
  .toLowerCase()
  .min(PAID_PLAN_ID_MIN_LENGTH)
  .max(PAID_PLAN_ID_MAX_LENGTH)
  .regex(PAID_PLAN_ID_PATTERN, 'Plan ID must be a lowercase slug containing only letters, numbers, and hyphens')
  .refine((value) => value !== 'trial', 'The plan ID "trial" is reserved')

const planLimitEntitlementInput = z.object({ enabled: z.boolean(), limit: nonNegativeInteger }).strict()
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
  // Phase 1 canonical ordering field. Legacy aliases remain accepted only as compatibility inputs.
  tierRank: tierRankInput.optional(),
  displayOrder: tierRankInput.optional(),
  upgradeRank: tierRankInput.optional(),
  priceMonthly: z.number().nonnegative(),
  priceYearly: z.number().nonnegative(),
  currency: z.literal('BDT'),
  description: z.string().max(1000).default(''),
  features: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  entitlements: planEntitlementsInput.optional(),
  maxTeamMembers: maxTeamMembers.optional(),
  // Transitional input alias for older dashboard builds. Parsed payloads are normalized to maxAgents for persistence.
  maxAgents: legacyMaxAgents.optional(),
  maxProperties: nonNegativeInteger,
  // Phase 1 canonical lead-capacity field. Legacy aliases remain accepted only when they agree.
  baseLeadCapacity: nonNegativeInteger.optional(),
  maxLeads: nonNegativeInteger.optional(),
  leadAllowanceModel: z.enum(['paid_period_credits', 'active_capacity']).default('paid_period_credits'),
  baseMonthlyLeadAllowance: nonNegativeInteger.optional(),
  renewalLeadBonus: nonNegativeInteger,
  renewalBonusEnabled: z.boolean(),
  maxRenewalLeadBonus: nonNegativeInteger,
  continuityGraceDays: z.number().int().min(0).max(31),
  maxRecurringLeadAddon: nonNegativeInteger.default(0),
  hasCustomDomain: z.boolean().default(false),
  hasAdvancedAnalytics: z.boolean().default(false),
  hasWhatsAppIntegration: z.boolean().default(false),
  hasLeadAutomations: z.boolean().default(false),
  hasSmsAutomation: z.boolean().default(false),
  hasPremiumTemplates: z.boolean().default(false),
  maxStorageMb: nonNegativeInteger.default(1024),
  maxMonthlyVisitors: nonNegativeInteger.default(10000),
  isPopular: z.boolean().default(false),
  isActive: z.boolean().default(true),
}

type CanonicalAliasInput = {
  tierRank?: number
  displayOrder?: number
  upgradeRank?: number
  baseLeadCapacity?: number
  maxLeads?: number
  baseMonthlyLeadAllowance?: number
  entitlements?: { leads?: { enabled: boolean; limit: number } }
}

const valuesAgree = (values: Array<number | undefined>) => {
  const supplied = values.filter((value): value is number => value !== undefined)
  return supplied.length < 2 || supplied.every((value) => value === supplied[0])
}

const validateCanonicalAliases = (value: CanonicalAliasInput, ctx: z.RefinementCtx, requireCanonicalConcepts: boolean) => {
  const rankValues = [value.tierRank, value.displayOrder, value.upgradeRank]
  if (requireCanonicalConcepts && rankValues.every((entry) => entry === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tierRank'], message: 'Plan tier is required' })
  } else if (!valuesAgree(rankValues)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tierRank'], message: 'Conflicting plan tier values were supplied. tierRank, displayOrder and upgradeRank must match during Phase 1.' })
  }

  const entitlementLeadLimit = value.entitlements?.leads?.limit
  const leadValues = [value.baseLeadCapacity, value.maxLeads, value.baseMonthlyLeadAllowance, entitlementLeadLimit]
  if (requireCanonicalConcepts && leadValues.every((entry) => entry === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['baseLeadCapacity'], message: 'Base lead capacity is required' })
  } else if (!valuesAgree(leadValues)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['baseLeadCapacity'], message: 'Conflicting lead capacities were supplied. baseLeadCapacity, maxLeads, baseMonthlyLeadAllowance and entitlements.leads.limit must match.' })
  }

  const resolvedLeadCapacity = leadValues.find((entry) => entry !== undefined)
  if (resolvedLeadCapacity !== undefined && value.entitlements?.leads && value.entitlements.leads.enabled !== (resolvedLeadCapacity > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entitlements', 'leads', 'enabled'], message: 'Lead entitlement enabled state must match whether base lead capacity is greater than zero.' })
  }
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

const normalizeCompatibilityAliases = <T extends Record<string, any>>(value: T) => {
  const {
    maxTeamMembers: canonicalTeamMembers,
    maxAgents: legacyTeamMembers,
    tierRank,
    displayOrder,
    upgradeRank,
    baseLeadCapacity,
    maxLeads,
    baseMonthlyLeadAllowance,
    ...rest
  } = value
  const resolvedTierRank = tierRank ?? upgradeRank ?? displayOrder
  const resolvedBaseLeadCapacity = baseLeadCapacity ?? baseMonthlyLeadAllowance ?? maxLeads ?? value.entitlements?.leads?.limit
  return {
    ...rest,
    ...(canonicalTeamMembers !== undefined || legacyTeamMembers !== undefined ? { maxAgents: canonicalTeamMembers ?? legacyTeamMembers } : {}),
    ...(resolvedTierRank !== undefined ? { tierRank: resolvedTierRank } : {}),
    ...(resolvedBaseLeadCapacity !== undefined ? { baseLeadCapacity: resolvedBaseLeadCapacity } : {}),
  }
}

const createBody = z.object({
  ...commercialShape,
  planId: paidPlanIdSchema,
  effectiveFrom: z.coerce.date().optional(),
  grandfatherExisting: z.boolean().default(true),
  changeReason: z.string().trim().min(10).max(500),
}).superRefine((value, ctx) => {
  requireTeamMemberLimit(value, ctx)
  validateCanonicalAliases(value, ctx, true)
}).transform(normalizeCompatibilityAliases)

const updateBody = z.object({
  name: commercialShape.name.optional(),
  tierRank: tierRankInput.optional(),
  displayOrder: tierRankInput.optional(),
  upgradeRank: tierRankInput.optional(),
  priceMonthly: commercialShape.priceMonthly.optional(),
  priceYearly: commercialShape.priceYearly.optional(),
  currency: commercialShape.currency.optional(),
  description: z.string().max(1000).optional(),
  features: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  entitlements: planEntitlementsInput.partial().optional(),
  maxTeamMembers: maxTeamMembers.optional(),
  maxAgents: legacyMaxAgents.optional(),
  maxProperties: commercialShape.maxProperties.optional(),
  baseLeadCapacity: nonNegativeInteger.optional(),
  maxLeads: nonNegativeInteger.optional(),
  leadAllowanceModel: commercialShape.leadAllowanceModel.optional(),
  baseMonthlyLeadAllowance: nonNegativeInteger.optional(),
  renewalLeadBonus: commercialShape.renewalLeadBonus.optional(),
  renewalBonusEnabled: commercialShape.renewalBonusEnabled.optional(),
  maxRenewalLeadBonus: commercialShape.maxRenewalLeadBonus.optional(),
  continuityGraceDays: commercialShape.continuityGraceDays.optional(),
  maxRecurringLeadAddon: commercialShape.maxRecurringLeadAddon.optional(),
  hasCustomDomain: z.boolean().optional(),
  hasAdvancedAnalytics: z.boolean().optional(),
  hasWhatsAppIntegration: z.boolean().optional(),
  hasLeadAutomations: z.boolean().optional(),
  hasSmsAutomation: z.boolean().optional(),
  hasPremiumTemplates: z.boolean().optional(),
  maxStorageMb: nonNegativeInteger.optional(),
  maxMonthlyVisitors: nonNegativeInteger.optional(),
  isPopular: z.boolean().optional(),
  isActive: z.boolean().optional(),
  effectiveFrom: z.coerce.date().optional(),
  grandfatherExisting: z.boolean().optional(),
  changeReason: z.string().trim().min(10).max(500),
}).superRefine((value, ctx) => {
  if (value.maxTeamMembers !== undefined && value.maxAgents !== undefined && value.maxTeamMembers !== value.maxAgents) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxTeamMembers'], message: 'Conflicting team member limits were supplied' })
  }
  validateCanonicalAliases(value, ctx, false)
  if (!Object.keys(value).some((key) => key !== 'changeReason')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one plan field must change' })
  }
}).transform(normalizeCompatibilityAliases)

export const SubscriptionPlanValidation = {
  create: z.object({ body: createBody }),
  update: z.object({ body: updateBody }),
  archive: z.object({ body: z.object({ reason: z.string().trim().min(10).max(500) }) }),
}
