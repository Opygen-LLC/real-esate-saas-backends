import mongoose, { Schema, Model } from 'mongoose'
import { ISubscriptionPlan } from './subscriptionPlan.interface'

const subscriptionPlanSchema = new Schema<ISubscriptionPlan>(
  {
    planId: {
      type: String,
      required: true,
      enum: ['starter', 'professional', 'agency', 'enterprise'],
      index: true,
    },
    version: { type: Number, required: true, min: 1 },
    name: { type: String, required: true },
    priceMonthly: { type: Number, required: true, min: 0 },
    priceYearly: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['BDT'], default: 'BDT' },
    description: { type: String, default: '' },
    features: { type: [String], default: [] },
    maxAgents: { type: Number, default: 3, min: 0 },
    maxProperties: { type: Number, default: 100, min: 0 },
    maxLeads: { type: Number, default: 500, min: 0 },
    // Historical plan versions default to paid-period credits. New cumulative-capacity
    // versions opt in explicitly so grandfathered tenants keep their original semantics.
    leadAllowanceModel: { type: String, enum: ['paid_period_credits', 'active_capacity'], default: 'paid_period_credits' },
    baseMonthlyLeadAllowance: { type: Number, default: 0, min: 0 },
    renewalLeadBonus: { type: Number, default: 0, min: 0 },
    renewalBonusEnabled: { type: Boolean, default: false },
    maxRenewalLeadBonus: { type: Number, default: 0, min: 0 },
    continuityGraceDays: { type: Number, default: 0, min: 0, max: 31 },
    hasCustomDomain: { type: Boolean, default: false },
    hasAdvancedAnalytics: { type: Boolean, default: false },
    hasWhatsAppIntegration: { type: Boolean, default: false },
    hasLeadAutomations: { type: Boolean, default: false },
    hasSmsAutomation: { type: Boolean, default: false },
    hasPremiumTemplates: { type: Boolean, default: false },
    maxStorageMb: { type: Number, default: 1024, min: 0 },
    maxMonthlyVisitors: { type: Number, default: 10000, min: 0 },
    isPopular: { type: Boolean, default: false },
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
  { planId: 1, isCurrent: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true } },
)
subscriptionPlanSchema.index({ isActive: 1, effectiveFrom: 1, effectiveTo: 1 })

export const SubscriptionPlan: Model<ISubscriptionPlan> = mongoose.model<ISubscriptionPlan>(
  'SubscriptionPlan',
  subscriptionPlanSchema,
)
