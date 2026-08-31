import mongoose, { Schema, model } from 'mongoose'
import { IOrganization, OrganizationModel } from './organization.interface'
import { WEBSITE_TEMPLATE_IDS } from '../websiteBuilder/websiteTemplate.constants'
import { ONBOARDING_TOTAL_STEPS, ONBOARDING_VERSION } from './onboarding.constants'
import { PAID_PLAN_ID_PATTERN } from '../subscriptionPlan/planIdentity'

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
    invoiceLogo: {
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
      trim: true,
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
      currentStep: { type: Number, default: 1, min: 1, max: ONBOARDING_TOTAL_STEPS },
      version: { type: Number, default: ONBOARDING_VERSION, min: 1 },
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
        trim: true,
        lowercase: true,
        validate: { validator: (value: string) => value === 'trial' || PAID_PLAN_ID_PATTERN.test(value), message: 'Invalid subscription plan ID' },
        default: 'trial',
      },
      planVersion: { type: Number, default: 1, min: 1 },
      revision: { type: Number, default: 0, min: 0 },
      status: {
        type: String,
        enum: ['trialing', 'active', 'past_due', 'grace', 'cancel_at_period_end', 'expired', 'suspended'],
        default: 'trialing',
      },
      currentPeriodStart: {
        type: Date,
        default: null,
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
      scheduledPlan: { type: String, trim: true, lowercase: true, match: PAID_PLAN_ID_PATTERN, default: null },
      scheduledPlanVersion: { type: Number, min: 1, default: null },
      scheduledBillingCycle: { type: String, enum: ['monthly', 'yearly', null], default: null },
      scheduledEffectiveAt: { type: Date, default: null },
      scheduledChangeRequestId: { type: Schema.Types.ObjectId, ref: 'SubscriptionChangeRequest', default: null },
      scheduledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      scheduledSource: { type: String, enum: ['bkash', 'manual_payment', 'manual_admin', null], default: null },
    },
    socialLinks: {
      facebook: { type: String, default: '' },
      instagram: { type: String, default: '' },
      twitter: { type: String, default: '' }, // legacy read compatibility; canonical writes use x
      x: { type: String, default: '' },
      linkedin: { type: String, default: '' },
      youtube: { type: String, default: '' },
      whatsapp: { type: String, default: '' },
    },
    templateId: {
      type: String,
      enum: [...WEBSITE_TEMPLATE_IDS],
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
      publicationRevision: { type: Number, min: 0, default: 0 },
      lastPublishedAt: { type: Date, default: null },
      content: { type: Schema.Types.Mixed, default: {} },
      // Stored as a nested Mongo-safe object and flattened to dotted stable section IDs at the API boundary.
      sectionStyles: { type: Schema.Types.Mixed, default: {} },
      footer: {
        showSocialLinks: { type: Boolean, default: true },
        socialVisibility: {
          facebook: { type: Boolean, default: true },
          instagram: { type: Boolean, default: true },
          youtube: { type: Boolean, default: true },
          x: { type: Boolean, default: true },
        },
      },
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
      status: { type: String, enum: ['active', 'suspended', 'archived', 'pending_deletion'], default: 'active', index: true },
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
      previousAccessStatus: { type: String, enum: ['active', 'suspended', 'archived', null], default: null },
      archivedAt: { type: Date, default: null },
      archivedBy: { type: String, default: '' },
      archiveReason: { type: String, default: '', maxlength: 500 },
      restoredAt: { type: Date, default: null },
      restoredBy: { type: String, default: '' },
      restoreReason: { type: String, default: '', maxlength: 500 },
      deletionRequestId: { type: String, default: null },
      deletionRequestedAt: { type: Date, default: null },
      deletionRequestedBy: { type: String, default: '' },
      deletionReason: { type: String, default: '', maxlength: 500 },
      deletionRetentionUntil: { type: Date, default: null },
      purgeUserIds: { type: [String], default: [] },
    },
    entitlementRestrictions: {
      premiumTemplates: { type: Boolean, default: false },
      customDomain: { type: Boolean, default: false },
      advancedAnalytics: { type: Boolean, default: false },
      whatsAppAutomation: { type: Boolean, default: false },
      smsAutomation: { type: Boolean, default: false },
      leadAutomations: { type: Boolean, default: false },
      storageWrites: { type: Boolean, default: false },
      storageOverageBytes: { type: Number, default: 0, min: 0 },
      updatedAt: { type: Date, default: null },
    },
    storageUsedBytes: { type: Number, default: 0, min: 0 },
    monthlyVisitorCount: { type: Number, default: 0, min: 0 },
    visitorUsageMonth: { type: String, default: '' },
    teamQuotaRevision: { type: Number, default: 0, min: 0, select: false },
    propertyQuotaRevision: { type: Number, default: 0, min: 0, select: false },
    leadQuotaRevision: { type: Number, default: 0, min: 0, select: false },
    subscriptionBenefitRevision: { type: Number, default: 0, min: 0, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
    },
  }
)

organizationSchema.index(
  { sub_domain: 1 },
  {
    unique: true,
    name: 'organization_subdomain_unique_nonempty',
    partialFilterExpression: { sub_domain: { $type: 'string', $gt: '' } },
  },
)
organizationSchema.index(
  { 'subscription.scheduledEffectiveAt': 1, organizationId: 1 },
  {
    name: 'subscription_due_schedule',
    partialFilterExpression: { 'subscription.scheduledEffectiveAt': { $type: 'date' } },
  },
)
organizationSchema.index(
  { ownerId: 1 },
  { unique: true, partialFilterExpression: { ownerId: { $type: 'objectId' } }, name: 'organization_owner_unique' },
)

export const Organization = model<IOrganization, OrganizationModel>(
  'Organization',
  organizationSchema
)
