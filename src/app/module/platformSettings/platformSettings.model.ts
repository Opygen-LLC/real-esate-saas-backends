import { Schema, model } from 'mongoose'
import { entitlementConfigSchema } from '../entitlement/entitlement.schema'

const platformSettingsSchema = new Schema({
  key: { type: String, enum: ['platform'], default: 'platform', unique: true },
  tax: {
    invoiceEnabled: { type: Boolean, default: false },
    registrationStatus: { type: String, enum: ['not_registered', 'registered'], default: 'not_registered' },
    operatorLegalName: { type: String, default: '' },
    binEncrypted: { type: String, default: '', select: false },
    vatRate: { type: Number, default: 0, min: 0, max: 100 },
    pricesIncludeVat: { type: Boolean, default: true },
  },
  privacy: {
    policyUrl: { type: String, default: '' },
    policyVersion: { type: String, default: '' },
    retentionDays: { type: Number, default: 365, min: 30, max: 3650 },
    legalReviewStatus: { type: String, enum: ['required', 'approved'], default: 'required' },
    legalReviewedAt: { type: Date, default: null },
  },
  support: {
    whatsapp: { type: String, default: '+8801891793354', maxlength: 20 },
    phone: { type: String, default: '+8801891793354', maxlength: 20 },
    email: { type: String, default: '', maxlength: 254 },
    facebook: { type: String, default: '', maxlength: 2048 },
    messenger: { type: String, default: '', maxlength: 2048 },
    instagram: { type: String, default: '', maxlength: 2048 },
    linkedin: { type: String, default: '', maxlength: 2048 },
    youtube: { type: String, default: '', maxlength: 2048 },
    website: { type: String, default: '', maxlength: 2048 },
  },
  trial: {
    enabled: { type: Boolean, default: true },
    defaultTrialDays: { type: Number, default: 14, min: 0, max: 365 },
    gracePeriodDays: { type: Number, default: 3, min: 0, max: 60 }, // legacy alias for trialGraceDays
    trialGraceDays: { type: Number, default: 3, min: 0, max: 60 },
    paidRenewalGraceDays: { type: Number, default: 0, min: 0, max: 60 },
    reminderDaysBeforeExpiry: { type: Number, default: 3, min: 0, max: 60 },
    entitlements: { type: entitlementConfigSchema, default: undefined },
    maxAgents: { type: Number, default: 2, min: 1, max: 9999 },
    maxProperties: { type: Number, default: 10, min: 1, max: 999999 },
    maxLeads: { type: Number, default: 100, min: 1, max: 9999999 },
    maxStorageMb: { type: Number, default: 512, min: 1, max: 1048576 },
    maxMonthlyVisitors: { type: Number, default: 5000, min: 1, max: 100000000 },
    hasPremiumTemplates: { type: Boolean, default: false },
    hasCustomDomain: { type: Boolean, default: false },
    hasAdvancedAnalytics: { type: Boolean, default: false },
    hasWhatsAppIntegration: { type: Boolean, default: false },
    hasSmsAutomation: { type: Boolean, default: false },
    hasLeadAutomations: { type: Boolean, default: false },
  },
  areaConversion: {
    kathaSqft: { type: Number, default: 720, min: 1 },
    bighaKatha: { type: Number, default: 20, min: 1 },
    note: { type: String, default: 'Operator-configurable regional convention' },
  },
}, { timestamps: true })

export const PlatformSettings = model('PlatformSettings', platformSettingsSchema)
