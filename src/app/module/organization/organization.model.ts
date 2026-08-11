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
      default: 'USA',
    },
    zipCode: {
      type: String,
      default: '',
    },
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
      index: true,
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
        enum: ['active', 'inactive', 'expired'],
        default: 'active',
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
    },
    socialLinks: {
      facebook: { type: String, default: '' },
      instagram: { type: String, default: '' },
      twitter: { type: String, default: '' },
      linkedin: { type: String, default: '' },
      youtube: { type: String, default: '' },
      whatsapp: { type: String, default: '' },
    },
    websiteSettings: {
      heroTitle: { type: String, default: 'Find Your Dream Home' },
      heroSubtitle: { type: String, default: 'Browse our curated selection of luxury properties' },
      featuredPropertiesCount: { type: Number, default: 6 },
      enableTestimonials: { type: Boolean, default: true },
      enableLeadForm: { type: Boolean, default: true },
      enableWhatsAppChat: { type: Boolean, default: true },
    },
    totalVisitor: {
      type: Number,
      default: 0,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
    },
  }
)

export const Organization = model<IOrganization, OrganizationModel>(
  'Organization',
  organizationSchema
)
