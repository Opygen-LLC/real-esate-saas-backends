import mongoose, { Model, Schema } from 'mongoose'
import { ISubscriptionBenefitPeriod } from './subscriptionBenefitPeriod.interface'

const subscriptionBenefitPeriodSchema = new Schema<ISubscriptionBenefitPeriod>(
  {
    organizationId: { type: String, required: true, index: true, trim: true },
    paymentSource: { type: String, enum: ['manual_payment', 'bkash'], required: true },
    paymentNumber: { type: String, required: true, trim: true },
    planId: { type: String, enum: ['starter', 'professional', 'agency', 'enterprise'], required: true, index: true },
    planVersion: { type: Number, required: true, min: 1 },
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
