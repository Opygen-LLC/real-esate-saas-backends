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
      default: '#1877F2',
    },
    secondaryColor: {
      type: String,
      default: '#0f172a',
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
    websiteStatus: {
      type: String,
      enum: ['provisioned', 'published', 'suspended'],
      default: 'provisioned',
      index: true,
    },
    onboarding: {
      status: { type: String, enum: ['not_started', 'in_progress', 'completed', 'skipped'], default: 'not_started', index: true },
      currentStep: { type: Number, default: 1, min: 1, max: 5 },
      version: { type: Number, default: 1, min: 1 },
      completedAt: { type: Date, default: null },
      skippedAt: { type: Date, default: null },
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
      planVersion: { type: Number, default: 1, min: 1 },
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
      source: { type: String, enum: ['trial', 'bkash', 'manual_payment', 'manual_admin', 'migration'], default: 'trial' },
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
      heroImage: { type: String, default: '' },
      featuredPropertiesCount: { type: Number, default: 6 },
      enableTestimonials: { type: Boolean, default: true },
      enableLeadForm: { type: Boolean, default: true },
      enableWhatsAppChat: { type: Boolean, default: true },
      renderMode: { type: String, enum: ['template', 'builder'], default: 'template' },
      content: { type: Schema.Types.Mixed, default: {} },
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
      index: true,
    },
    platformAccess: {
      status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
      suspendedAt: { type: Date, default: null },
      suspendedBy: { type: String, default: '' },
      suspensionReason: { type: String, default: '', maxlength: 500 },
      previousSubscriptionStatus: { type: String, enum: ['trialing', 'active', 'past_due', 'grace', 'cancel_at_period_end', 'expired', 'suspended', null], default: null },
      previousWebsiteStatus: { type: String, enum: ['provisioned', 'published', 'suspended', null], default: null },
      suspensionSource: { type: String, enum: ['tenant', 'owner_user', null], default: null },
      suspensionUserId: { type: String, default: null },
      reactivatedAt: { type: Date, default: null },
      reactivatedBy: { type: String, default: '' },
      reactivationReason: { type: String, default: '', maxlength: 500 },
    },
    storageUsedBytes: { type: Number, default: 0, min: 0 },
    monthlyVisitorCount: { type: Number, default: 0, min: 0 },
    visitorUsageMonth: { type: String, default: '' },
    teamQuotaRevision: { type: Number, default: 0, min: 0, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
    },
  }
)

organizationSchema.index({ sub_domain: 1 }, { unique: true })
organizationSchema.index(
  { ownerId: 1 },
  { unique: true, partialFilterExpression: { ownerId: { $type: 'objectId' } }, name: 'organization_owner_unique' },
)

export const Organization = model<IOrganization, OrganizationModel>(
  'Organization',
  organizationSchema
)
