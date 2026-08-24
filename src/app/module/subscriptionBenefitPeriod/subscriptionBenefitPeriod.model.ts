import mongoose, { Model, Schema } from 'mongoose'
import { ISubscriptionBenefitPeriod } from './subscriptionBenefitPeriod.interface'
import { PAID_PLAN_ID_PATTERN } from '../subscriptionPlan/planIdentity'

const subscriptionBenefitPeriodSchema = new Schema<ISubscriptionBenefitPeriod>(
  {
    organizationId: { type: String, required: true, index: true, trim: true },
    paymentSource: { type: String, enum: ['manual_payment', 'bkash', 'manual_admin'], required: true },
    paymentNumber: { type: String, required: true, trim: true },
    planId: { type: String, required: true, trim: true, lowercase: true, minlength: 3, maxlength: 50, match: PAID_PLAN_ID_PATTERN, index: true },
    planVersion: { type: Number, required: true, min: 1 },
    // Phase 5 canonical audit snapshot. Historical rows legitimately omit these.
    ledgerVersion: { type: Number, enum: [2], default: undefined, index: true },
    baseLeadCapacity: { type: Number, min: 0, default: undefined },
    recurringAddonCapacity: { type: Number, min: 0, default: undefined },
    effectiveLeadCapacity: { type: Number, min: 0, default: undefined },
    // Missing historical rows are interpreted as paid-period credits for grandfathering.
    leadAllowanceModel: { type: String, enum: ['paid_period_credits', 'active_capacity'], default: 'paid_period_credits' },
    billingCycle: { type: String, enum: ['monthly', 'yearly', 'one-time'], required: true },
    periodStart: { type: Date, required: true, index: true },
    periodEnd: { type: Date, required: true, index: true },
    renewalStreak: { type: Number, required: true, min: 1, default: 1 },
    baseLeadAllowance: { type: Number, required: true, min: 0 },
    bonusLeadAllowance: { type: Number, required: true, min: 0, default: 0 },
    totalLeadAllowance: { type: Number, required: true, min: 0 },
    usedLeadAllowance: { type: Number, required: true, min: 0, default: 0 },
    renewalBonusEnabled: { type: Boolean, required: true, default: false },
    renewalLeadBonus: { type: Number, required: true, min: 0, default: 0 },
    maxRenewalLeadBonus: { type: Number, required: true, min: 0, default: 0 },
    continuityGraceDays: { type: Number, required: true, min: 0, max: 31, default: 0 },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: String, default: null },
    voidReason: { type: String, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
)

subscriptionBenefitPeriodSchema.index(
  { paymentSource: 1, paymentNumber: 1 },
  { unique: true, name: 'unique_payment_benefit_period' },
)
subscriptionBenefitPeriodSchema.index(
  { organizationId: 1, periodStart: -1, _id: -1 },
  { name: 'tenant_benefit_history' },
)
subscriptionBenefitPeriodSchema.index(
  { organizationId: 1, createdAt: -1, _id: -1 },
  { name: 'tenant_continuity_confirmation_order' },
)
subscriptionBenefitPeriodSchema.index(
  { organizationId: 1, planId: 1, billingCycle: 1, periodEnd: -1, _id: -1 },
  { name: 'tenant_plan_continuity' },
)
subscriptionBenefitPeriodSchema.index(
  { organizationId: 1, periodStart: 1, periodEnd: 1 },
  { name: 'tenant_active_benefit_period' },
)

export const SubscriptionBenefitPeriod: Model<ISubscriptionBenefitPeriod> =
  mongoose.models.SubscriptionBenefitPeriod
  || mongoose.model<ISubscriptionBenefitPeriod>('SubscriptionBenefitPeriod', subscriptionBenefitPeriodSchema)
