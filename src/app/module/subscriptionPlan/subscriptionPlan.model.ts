import mongoose, { Schema, Model } from 'mongoose'
import { ISubscriptionPlan } from './subscriptionPlan.interface'
import { entitlementConfigSchema } from '../entitlement/entitlement.schema'
import { PAID_PLAN_ID_PATTERN } from './planIdentity'

const subscriptionPlanSchema = new Schema<ISubscriptionPlan>(
  {
    planId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 50,
      match: PAID_PLAN_ID_PATTERN,
      validate: { validator: (value: string) => value !== 'trial', message: 'trial is reserved for the platform trial policy' },
      index: true,
    },
    version: { type: Number, required: true, min: 1 },
    name: { type: String, required: true },
    // Phase 1 canonical ordering field. Historical documents may not have it yet.
    tierRank: { type: Number, min: 0, index: true },
    // Legacy mirrors retained until all old readers are retired.
    displayOrder: { type: Number, required: true, min: 0, index: true },
    upgradeRank: { type: Number, required: true, min: 0, index: true },
    priceMonthly: { type: Number, required: true, min: 0 },
    priceYearly: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['BDT'], default: 'BDT' },
    description: { type: String, default: '' },
    features: { type: [String], default: [] },
    entitlements: { type: entitlementConfigSchema, default: undefined },
    maxAgents: { type: Number, default: 3, min: 0 },
    maxProperties: { type: Number, default: 100, min: 0 },
    // Phase 1 canonical lead-capacity field. Historical documents may not have it yet.
    baseLeadCapacity: { type: Number, min: 0, index: true },
    // Historical immutable versions may still carry this legacy alias.
    // No default: Phase 5 new plan versions must not persist maxLeads.
    maxLeads: { type: Number, default: undefined, min: 0 },
    // Phase 3: new plan versions store only baseLeadCapacity plus a system-owned
    // policy marker. These fields remain in the schema solely to read immutable
    // historical versions that used renewal growth or paid-period credits.
    leadPolicyVersion: { type: Number, enum: [2], default: undefined, index: true },
    leadAllowanceModel: { type: String, enum: ['paid_period_credits', 'active_capacity'], default: undefined },
    baseMonthlyLeadAllowance: { type: Number, min: 0, default: undefined },
    renewalLeadBonus: { type: Number, min: 0, default: undefined },
    renewalBonusEnabled: { type: Boolean, default: undefined },
    maxRenewalLeadBonus: { type: Number, min: 0, default: undefined },
    continuityGraceDays: { type: Number, min: 0, max: 31, default: undefined },
    // Phase 4 canonical recurring add-on ceiling. null means unlimited; 0 disables add-ons.
    maxAddonLeadCapacity: { type: Number, default: undefined, min: 0 },
    // Legacy field retained only for reading historical immutable versions.
    maxRecurringLeadAddon: { type: Number, default: undefined, min: 0 },
    hasCustomDomain: { type: Boolean, default: false },
    hasAdvancedAnalytics: { type: Boolean, default: false },
    hasWhatsAppIntegration: { type: Boolean, default: false },
    hasLeadAutomations: { type: Boolean, default: false },
    hasSmsAutomation: { type: Boolean, default: false },
    hasPremiumTemplates: { type: Boolean, default: false },
    hasAdvancedAccounting: { type: Boolean, default: false },
    maxStorageMb: { type: Number, default: 1024, min: 0 },
    maxMonthlyVisitors: { type: Number, default: 10000, min: 0 },
    isPopular: { type: Boolean, default: false },
    status: { type: String, enum: ['scheduled', 'current', 'grandfathered', 'retired'], index: true },
    isActive: { type: Boolean, default: true, index: true },
    isCurrent: { type: Boolean, default: true, index: true },
    effectiveFrom: { type: Date, required: true, default: Date.now, index: true },
    effectiveTo: { type: Date, default: null, index: true },
    grandfatherExisting: { type: Boolean, default: true },
    migrationAppliedAt: { type: Date, default: null },
    changeReason: { type: String, default: '', maxlength: 500 },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true, toJSON: { virtuals: true } }
)

subscriptionPlanSchema.index({ planId: 1, version: 1 }, { unique: true })
subscriptionPlanSchema.index(
  { planId: 1, status: 1 },
  { name: 'planId_1_status_1_current_unique', unique: true, partialFilterExpression: { status: 'current' } },
)
subscriptionPlanSchema.index(
  { planId: 1, isCurrent: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true } },
)
subscriptionPlanSchema.index({ isActive: 1, effectiveFrom: 1, effectiveTo: 1 })
subscriptionPlanSchema.index({ status: 1, tierRank: 1 })
subscriptionPlanSchema.index({ isCurrent: 1, isActive: 1, tierRank: 1 })
subscriptionPlanSchema.index({ isCurrent: 1, isActive: 1, displayOrder: 1, upgradeRank: 1 })
subscriptionPlanSchema.index(
  { tierRank: 1 },
  {
    name: 'current_active_tier_rank_unique',
    unique: true,
    partialFilterExpression: {
      isCurrent: true,
      isActive: true,
      tierRank: { $type: 'number' },
    },
  },
)
subscriptionPlanSchema.index(
  { upgradeRank: 1 },
  {
    name: 'current_active_upgrade_rank_unique',
    unique: true,
    partialFilterExpression: {
      isCurrent: true,
      isActive: true,
      upgradeRank: { $type: 'number' },
    },
  },
)

export const SubscriptionPlan: Model<ISubscriptionPlan> = mongoose.model<ISubscriptionPlan>(
  'SubscriptionPlan',
  subscriptionPlanSchema,
)
