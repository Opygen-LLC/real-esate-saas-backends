import mongoose, { Model } from 'mongoose'
import type { WebsiteTemplateId } from '../websiteBuilder/websiteTemplate.constants'

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'grace' | 'cancel_at_period_end' | 'expired' | 'suspended'
export type OnboardingStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped'

export interface ISubscription {
  plan: string
  planVersion?: number
  revision?: number
  status: SubscriptionStatus
  currentPeriodEnd: Date | null
  lastPaymentDate: Date | null
  maxProperties?: number
  maxAgents?: number
  trialEndsAt?: Date | null
  gracePeriodEnd?: Date | null
  cancelAtPeriodEnd?: boolean
  reminderSentAt?: Date | null
  source?: 'trial' | 'bkash' | 'manual_payment' | 'manual_admin' | 'migration'
  scheduledPlan?: string | null
  scheduledPlanVersion?: number | null
  scheduledBillingCycle?: 'monthly' | 'yearly' | null
  scheduledEffectiveAt?: Date | null
  scheduledChangeRequestId?: mongoose.Types.ObjectId | string | null
  scheduledBy?: mongoose.Types.ObjectId | string | null
  scheduledSource?: 'bkash' | 'manual_payment' | 'manual_admin' | null
}

export interface IPlatformAccess {
  status: 'active' | 'suspended' | 'archived' | 'pending_deletion'
  suspendedAt?: Date | null
  suspendedBy?: string
  suspensionReason?: string
  previousSubscriptionStatus?: SubscriptionStatus | null
  previousWebsiteStatus?: 'provisioned' | 'published' | 'suspended' | null
  suspensionSource?: 'tenant' | 'owner_user' | null
  suspensionUserId?: string | null
  reactivatedAt?: Date | null
  reactivatedBy?: string
  reactivationReason?: string
  previousAccessStatus?: 'active' | 'suspended' | 'archived' | null
  archivedAt?: Date | null
  archivedBy?: string
  archiveReason?: string
  restoredAt?: Date | null
  restoredBy?: string
  restoreReason?: string
  deletionRequestId?: string | null
  deletionRequestedAt?: Date | null
  deletionRequestedBy?: string
  deletionReason?: string
  deletionRetentionUntil?: Date | null
}

export interface IServiceArea {
  city: string
  state?: string
  country?: string
  zipCodes?: string[]
}

export interface IOnboardingState {
  status: OnboardingStatus
  currentStep: number
  version: number
  completedAt?: Date | null
  skippedAt?: Date | null
}

export interface IOrganization {
  organizationId: string
  agencyName: string
  agencyType: 'residential' | 'commercial' | 'mixed' | 'brokerage' | 'developer' | 'general'
  licenseNumber?: string
  ownerId?: mongoose.Types.ObjectId | string
  email: string
  phone: string
  address?: string
  city?: string
  state?: string
  country?: string
  zipCode?: string
  defaultLanguage?: 'en' | 'bn'
  addressDetails?: {
    divisionId?: string; division?: string; districtId?: string; district?: string; upazilaId?: string; upazila?: string
    areaId?: string; area?: string; road?: string; block?: string; sector?: string; mouza?: string; postalCode?: string; landmark?: string
  }
  areaConversion?: { kathaSqft?: number; bighaKatha?: number }
  serviceAreas?: string[] | IServiceArea[]
  logo?: string
  favicon?: string
  primaryColor?: string
  secondaryColor?: string
  font?: string
  metaTitle?: string
  metaDescription?: string
  domain?: string
  sub_domain?: string
  domain_Verify?: boolean
  websiteStatus?: 'provisioned' | 'published' | 'suspended'
  websiteUrl?: string
  domain_dns?: Array<{ type: string; name: string; value: string }>
  onboarding?: IOnboardingState
  subscription: ISubscription
  platformAccess?: IPlatformAccess
  socialLinks?: {
    facebook?: string
    instagram?: string
    twitter?: string
    linkedin?: string
    youtube?: string
    whatsapp?: string
  }
  templateId?: WebsiteTemplateId
  websiteSettings?: {
    heroTitle?: string
    heroSubtitle?: string
    heroImage?: string
    featuredPropertiesCount?: number
    enableTestimonials?: boolean
    enableLeadForm?: boolean
    enableWhatsAppChat?: boolean
    renderMode?: 'template' | 'builder'
    content?: Record<string, any>
  }
  teamSettings?: {
    defaultRole?: 'agent' | 'staff' | 'agency_admin'
    agentsCanViewAllLeads?: boolean
    leaderboardVisible?: boolean
    autoAssignLeads?: boolean
  }
  totalVisitor?: number
  isBlocked?: boolean
  entitlementRestrictions?: {
    premiumTemplates?: boolean
    customDomain?: boolean
    advancedAnalytics?: boolean
    whatsAppAutomation?: boolean
    smsAutomation?: boolean
    leadAutomations?: boolean
    storageWrites?: boolean
    storageOverageBytes?: number
    updatedAt?: Date | null
  }
  storageUsedBytes?: number
  monthlyVisitorCount?: number
  visitorUsageMonth?: string
  teamQuotaRevision?: number
  propertyQuotaRevision?: number
  leadQuotaRevision?: number
  subscriptionBenefitRevision?: number
  createdAt?: Date
  updatedAt?: Date
}

export type IOrganizationFilter = {
  searchTerm?: string
  agencyType?: string
  status?: string
}

export type OrganizationModel = Model<IOrganization>
