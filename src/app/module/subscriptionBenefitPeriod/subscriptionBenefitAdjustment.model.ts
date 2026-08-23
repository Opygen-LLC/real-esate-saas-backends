import mongoose, { Model, Schema } from 'mongoose'
import type { ISubscriptionBenefitStreakAdjustment } from './subscriptionBenefitAdjustment.interface'
import { PAID_PLAN_ID_PATTERN } from '../subscriptionPlan/planIdentity'

const subscriptionBenefitStreakAdjustmentSchema = new Schema<ISubscriptionBenefitStreakAdjustment>(
  {
    organizationId: { type: String, required: true, trim: true, index: true },
    benefitPeriodId: { type: String, required: true, trim: true, index: true },
    paymentNumber: { type: String, required: true, trim: true },
    planId: { type: String, required: true, trim: true, lowercase: true, minlength: 3, maxlength: 50, match: PAID_PLAN_ID_PATTERN },
    planVersion: { type: Number, required: true, min: 1 },
    previousEffectiveRenewalStreak: { type: Number, required: true, min: 1 },
    adjustedRenewalStreak: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, trim: true, minlength: 10, maxlength: 500 },
    actorId: { type: String, required: true, trim: true },
    requestId: { type: String, default: '', trim: true },
    ip: { type: String, default: '', trim: true },
  },
  { timestamps: true, versionKey: false },
)

subscriptionBenefitStreakAdjustmentSchema.index(
  { organizationId: 1, benefitPeriodId: 1, createdAt: -1, _id: -1 },
  { name: 'tenant_benefit_streak_adjustment_order' },
)
subscriptionBenefitStreakAdjustmentSchema.index(
  { organizationId: 1, createdAt: -1, _id: -1 },
  { name: 'tenant_benefit_streak_adjustment_history' },
)

const immutable = (next: (error?: Error) => void) => next(new Error('Subscription benefit streak adjustments are immutable'))
subscriptionBenefitStreakAdjustmentSchema.pre('updateOne', immutable)
subscriptionBenefitStreakAdjustmentSchema.pre('updateMany', immutable)
subscriptionBenefitStreakAdjustmentSchema.pre('findOneAndUpdate', immutable)
subscriptionBenefitStreakAdjustmentSchema.pre('deleteOne', immutable)
subscriptionBenefitStreakAdjustmentSchema.pre('deleteMany', immutable)
subscriptionBenefitStreakAdjustmentSchema.pre('findOneAndDelete', immutable)

export const SubscriptionBenefitStreakAdjustment: Model<ISubscriptionBenefitStreakAdjustment> =
  mongoose.models.SubscriptionBenefitStreakAdjustment
  || mongoose.model<ISubscriptionBenefitStreakAdjustment>('SubscriptionBenefitStreakAdjustment', subscriptionBenefitStreakAdjustmentSchema)
