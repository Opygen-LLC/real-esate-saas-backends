import { Schema, model } from 'mongoose'

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
  areaConversion: {
    kathaSqft: { type: Number, default: 720, min: 1 },
    bighaKatha: { type: Number, default: 20, min: 1 },
    note: { type: String, default: 'Operator-configurable regional convention' },
  },
}, { timestamps: true })

export const PlatformSettings = model('PlatformSettings', platformSettingsSchema)
