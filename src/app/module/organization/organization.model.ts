import mongoose, { Schema, model } from 'mongoose'
import { IOrganization, OrganizationModel } from './organization.interface'

const organizationSchema = new Schema<IOrganization, OrganizationModel>(
  {
    organizationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    agencyName: {
      type: String,
      required: true,
      trim: true,
    },
    agencyType: {
      type: String,
      enum: ['residential', 'commercial', 'mixed', 'brokerage', 'developer', 'general'],
      default: 'residential',
    },
    licenseNumber: {
      type: String,
      default: '',
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    email: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      default: '',
    },
    city: {
      type: String,
      default: '',
    },
    state: {
      type: String,
      default: '',
    },
    country: {
      type: String,
      default: 'Bangladesh',
    },
    zipCode: {
      type: String,
      default: '',
    },
    defaultLanguage: { type: String, enum: ['en', 'bn'], default: 'en' },
    addressDetails: {
      divisionId: { type: String, default: '' }, division: { type: String, default: '' }, districtId: { type: String, default: '' },
      district: { type: String, default: '' }, upazilaId: { type: String, default: '' }, upazila: { type: String, default: '' },
      areaId: { type: String, default: '' }, area: { type: String, default: '' }, road: { type: String, default: '' },
      block: { type: String, default: '' }, sector: { type: String, default: '' }, mouza: { type: String, default: '' },
      postalCode: { type: String, default: '' }, landmark: { type: String, default: '' },
    },
    areaConversion: { kathaSqft: { type: Number, default: 720, min: 1 }, bighaKatha: { type: Number, default: 20, min: 1 } },
    serviceAreas: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    logo: {
      type: String,
      default: '',
    },
    favicon: {
      type: String,
      default: '',
    },
    primaryColor: {
      type: String,
      default: '#0f172a',
    },
    secondaryColor: {
      type: String,
      default: '#3b82f6',
    },
    font: {
      type: String,
      default: 'Inter',
    },
    metaTitle: {
      type: String,
      default: '',
    },
    metaDescription: {
      type: String,
      default: '',
    },
    domain: {
      type: String,
      default: '',
    },
    sub_domain: {
      type: String,
      default: '',
      lowercase: true,
    },
    domain_Verify: {
      type: Boolean,
      default: false,
    },
    domain_dns: {
      type: [Object],
      default: [],
    },
    subscription: {
      plan: {
        type: String,
        enum: ['trial', 'starter', 'professional', 'agency', 'enterprise'],
        default: 'trial',
      },
      status: {
        type: String,
        enum: ['trialing', 'active', 'past_due', 'grace', 'cancel_at_period_end', 'expired', 'suspended'],
        default: 'trialing',
      },
      currentPeriodEnd: {
        type: Date,
        default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14-day trial
      },
      lastPaymentDate: {
        type: Date,
        default: Date.now,
      },
      maxProperties: {
        type: Number,
        default: 100,
      },
      maxAgents: {
        type: Number,
        default: 3,
      },
      trialEndsAt: { type: Date, default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
      gracePeriodEnd: { type: Date, default: null },
      cancelAtPeriodEnd: { type: Boolean, default: false },
      reminderSentAt: { type: Date, default: null },
    },
    socialLinks: {
      facebook: { type: String, default: '' },
      instagram: { type: String, default: '' },
      twitter: { type: String, default: '' },
      linkedin: { type: String, default: '' },
      youtube: { type: String, default: '' },
      whatsapp: { type: String, default: '' },
    },
    templateId: {
      type: String,
      enum: ['template-1', 'template-2', 'template-3', 'template-4'],
      default: 'template-1',
    },
    websiteSettings: {
      heroTitle: { type: String, default: 'Find Your Dream Home' },
      heroSubtitle: { type: String, default: 'Browse our curated selection of luxury properties' },
      heroImage: { type: String, default: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1920&q=80' },
      featuredPropertiesCount: { type: Number, default: 6 },
      enableTestimonials: { type: Boolean, default: true },
      enableLeadForm: { type: Boolean, default: true },
      enableWhatsAppChat: { type: Boolean, default: true },
    },
    teamSettings: {
      defaultRole: { type: String, enum: ['agent', 'staff', 'agency_admin'], default: 'agent' },
      agentsCanViewAllLeads: { type: Boolean, default: true },
      leaderboardVisible: { type: Boolean, default: true },
      autoAssignLeads: { type: Boolean, default: true },
    },
    totalVisitor: {
      type: Number,
      default: 0,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    storageUsedBytes: { type: Number, default: 0, min: 0 },
    monthlyVisitorCount: { type: Number, default: 0, min: 0 },
    visitorUsageMonth: { type: String, default: '' },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
    },
  }
)

organizationSchema.index({ sub_domain: 1 }, { unique: true })

export const Organization = model<IOrganization, OrganizationModel>(
  'Organization',
  organizationSchema
)
