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

// Phase 3: these fields remain readable on historical immutable versions, but they
// are no longer legal inputs for creating a plan family or a new plan version.
const forbiddenRenewalGrowthFields = {
  leadPolicyVersion: z.never().optional(),
  leadAllowanceModel: z.never().optional(),
  baseMonthlyLeadAllowance: z.never().optional(),
  renewalLeadBonus: z.never().optional(),
  renewalBonusEnabled: z.never().optional(),
  maxRenewalLeadBonus: z.never().optional(),
  continuityGraceDays: z.never().optional(),
}

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
  // Transitional alias for older dashboard builds. Parsed payloads normalize to maxAgents for persistence.
  maxAgents: legacyMaxAgents.optional(),
  maxProperties: nonNegativeInteger,
  // Phase 1 canonical lead-capacity field. maxLeads remains an accepted compatibility alias.
  baseLeadCapacity: nonNegativeInteger.optional(),
  maxLeads: nonNegativeInteger.optional(),
  maxAddonLeadCapacity: nonNegativeInteger.nullable().optional(),
  // Transitional alias accepted from older dashboard builds. New writes normalize to maxAddonLeadCapacity.
  maxRecurringLeadAddon: nonNegativeInteger.optional(),
  hasCustomDomain: z.boolean().default(false),
  hasAdvancedAnalytics: z.boolean().default(false),
  hasWhatsAppIntegration: z.boolean().default(false),
  hasLeadAutomations: z.boolean().default(false),
  hasSmsAutomation: z.boolean().default(false),
  hasPremiumTemplates: z.boolean().default(false),
  maxStorageMb: nonNegativeInteger.default(1024),
  maxMonthlyVisitors: nonNegativeInteger.default(10000),
  isPopular: z.boolean().default(false),
  ...forbiddenRenewalGrowthFields,
}

type CanonicalAliasInput = {
  tierRank?: number
  displayOrder?: number
  upgradeRank?: number
  baseLeadCapacity?: number
  maxLeads?: number
  maxAddonLeadCapacity?: number | null
  maxRecurringLeadAddon?: number
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
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tierRank'], message: 'Conflicting plan tier values were supplied. tierRank, displayOrder and upgradeRank must match during compatibility.' })
  }

  const entitlementLeadLimit = value.entitlements?.leads?.limit
  const leadValues = [value.baseLeadCapacity, value.maxLeads, entitlementLeadLimit]
  if (requireCanonicalConcepts && leadValues.every((entry) => entry === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['baseLeadCapacity'], message: 'Base lead capacity is required' })
  } else if (!valuesAgree(leadValues)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['baseLeadCapacity'], message: 'Conflicting lead capacities were supplied. baseLeadCapacity, maxLeads and entitlements.leads.limit must match.' })
  }

  const resolvedLeadCapacity = leadValues.find((entry) => entry !== undefined)
  if (resolvedLeadCapacity !== undefined && value.entitlements?.leads && value.entitlements.leads.enabled !== (resolvedLeadCapacity > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entitlements', 'leads', 'enabled'], message: 'Lead entitlement enabled state must match whether base lead capacity is greater than zero.' })
  }


  if (value.maxAddonLeadCapacity !== undefined && value.maxRecurringLeadAddon !== undefined) {
    if (value.maxAddonLeadCapacity === null || value.maxAddonLeadCapacity !== value.maxRecurringLeadAddon) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxAddonLeadCapacity'], message: 'Conflicting recurring add-on ceilings were supplied. Use maxAddonLeadCapacity only; null means unlimited.' })
    }
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
    maxAddonLeadCapacity,
    maxRecurringLeadAddon,
    ...rest
  } = value
  const resolvedTierRank = tierRank ?? upgradeRank ?? displayOrder
  const resolvedBaseLeadCapacity = baseLeadCapacity ?? maxLeads ?? value.entitlements?.leads?.limit
  const resolvedAddonCapacity = maxAddonLeadCapacity !== undefined ? maxAddonLeadCapacity : maxRecurringLeadAddon
  return {
    ...rest,
    ...(canonicalTeamMembers !== undefined || legacyTeamMembers !== undefined ? { maxAgents: canonicalTeamMembers ?? legacyTeamMembers } : {}),
    ...(resolvedTierRank !== undefined ? { tierRank: resolvedTierRank } : {}),
    ...(resolvedBaseLeadCapacity !== undefined ? { baseLeadCapacity: resolvedBaseLeadCapacity } : {}),
    ...(resolvedAddonCapacity !== undefined ? { maxAddonLeadCapacity: resolvedAddonCapacity } : {}),
  }
}

// Phase 2 lifecycle remains system-owned. Super Admin edits commercial fields only.
const forbiddenLifecycleCreateFields = {
  status: z.never().optional(),
  isActive: z.never().optional(),
  isCurrent: z.never().optional(),
  grandfatherExisting: z.never().optional(),
  effectiveFrom: z.never().optional(),
  effectiveTo: z.never().optional(),
  migrationAppliedAt: z.never().optional(),
}

const forbiddenLifecycleUpdateFields = {
  planId: z.never().optional(),
  ...forbiddenLifecycleCreateFields,
}

const createBody = z.object({
  ...commercialShape,
  ...forbiddenLifecycleCreateFields,
  planId: paidPlanIdSchema,
  changeReason: z.string().trim().min(10).max(500),
}).superRefine((value, ctx) => {
  requireTeamMemberLimit(value, ctx)
  validateCanonicalAliases(value, ctx, true)
}).transform(normalizeCompatibilityAliases)

const updateBody = z.object({
  ...forbiddenLifecycleUpdateFields,
  ...forbiddenRenewalGrowthFields,
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
  maxAddonLeadCapacity: nonNegativeInteger.nullable().optional(),
  maxRecurringLeadAddon: nonNegativeInteger.optional(),
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
  if (value.maxTeamMembers !== undefined && value.maxAgents !== undefined && value.maxTeamMembers !== value.maxAgents) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxTeamMembers'], message: 'Conflicting team member limits were supplied' })
  }
  validateCanonicalAliases(value, ctx, false)
  if (!Object.keys(value).some((key) => key !== 'changeReason')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one commercial plan field must change' })
  }
}).transform(normalizeCompatibilityAliases)

export const SubscriptionPlanValidation = {
  create: z.object({ body: createBody }),
  update: z.object({ body: updateBody }),
  archive: z.object({ body: z.object({ reason: z.string().trim().min(10).max(500) }) }),
}
