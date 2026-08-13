import mongoose, { Schema, Model } from 'mongoose'
import { ISubscriptionPlan } from './subscriptionPlan.interface'

const subscriptionPlanSchema = new Schema<ISubscriptionPlan>(
  {
    planId: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    priceMonthly: {
      type: Number,
      required: true,
    },
    priceYearly: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'BDT',
    },
    description: {
      type: String,
      default: '',
    },
    features: {
      type: [String],
      default: [],
    },
    maxAgents: {
      type: Number,
      default: 3,
    },
    maxProperties: {
      type: Number,
      default: 100,
    },
    maxLeads: {
      type: Number,
      default: 500,
    },
    hasCustomDomain: {
      type: Boolean,
      default: false,
    },
    hasAdvancedAnalytics: {
      type: Boolean,
      default: false,
    },
    hasWhatsAppIntegration: {
      type: Boolean,
      default: false,
    },
    hasLeadAutomations: {
      type: Boolean,
      default: false,
    },
    hasSmsAutomation: { type: Boolean, default: false },
    hasPremiumTemplates: { type: Boolean, default: false },
    maxStorageMb: { type: Number, default: 1024, min: 0 },
    maxMonthlyVisitors: { type: Number, default: 10000, min: 0 },
    isPopular: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
    },
  }
)

export const SubscriptionPlan: Model<ISubscriptionPlan> = mongoose.model<ISubscriptionPlan>(
  'SubscriptionPlan',
  subscriptionPlanSchema
)
