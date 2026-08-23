import { Schema } from 'mongoose'

const entitlementValueSchema = new Schema({
  enabled: { type: Boolean, required: true, default: false },
  limit: { type: Number, min: 0, default: undefined },
}, { _id: false })

export const entitlementConfigSchema = new Schema({
  leads: { type: entitlementValueSchema, default: undefined },
  properties: { type: entitlementValueSchema, default: undefined },
  teamMembers: { type: entitlementValueSchema, default: undefined },
  storage: { type: entitlementValueSchema, default: undefined },
  monthlyVisitors: { type: entitlementValueSchema, default: undefined },
  customDomain: { type: entitlementValueSchema, default: undefined },
  advancedAnalytics: { type: entitlementValueSchema, default: undefined },
  whatsappIntegration: { type: entitlementValueSchema, default: undefined },
  smsAutomation: { type: entitlementValueSchema, default: undefined },
  leadAutomations: { type: entitlementValueSchema, default: undefined },
  premiumTemplates: { type: entitlementValueSchema, default: undefined },
}, { _id: false })
