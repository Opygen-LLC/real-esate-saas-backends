import mongoose, { Model } from 'mongoose'

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'grace' | 'cancel_at_period_end' | 'expired' | 'suspended'

export interface ISubscription {
  plan: 'trial' | 'starter' | 'professional' | 'agency' | 'enterprise'
  planVersion?: number
  status: SubscriptionStatus
  currentPeriodEnd: Date | null
  lastPaymentDate: Date | null
  maxProperties?: number
  maxAgents?: number
  trialEndsAt?: Date | null
  gracePeriodEnd?: Date | null
  cancelAtPeriodEnd?: boolean
  reminderSentAt?: Date | null
}

export interface IPlatformAccess {
  status: 'active' | 'suspended'
  suspendedAt?: Date | null
  suspendedBy?: string
  suspensionReason?: string
  previousSubscriptionStatus?: SubscriptionStatus | null
  reactivatedAt?: Date | null
  reactivatedBy?: string
  reactivationReason?: string
}

export interface IServiceArea {
  city: string
  state?: string
  country?: string
  zipCodes?: string[]
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
  domain_dns?: Array<{ type: string; name: string; value: string }>
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
  templateId?: 'template-1' | 'template-2' | 'template-3' | 'template-4'
  websiteSettings?: {
    heroTitle?: string
    heroSubtitle?: string
    heroImage?: string
    featuredPropertiesCount?: number
    enableTestimonials?: boolean
    enableLeadForm?: boolean
    enableWhatsAppChat?: boolean
  }
  teamSettings?: {
    defaultRole?: 'agent' | 'staff' | 'agency_admin'
    agentsCanViewAllLeads?: boolean
    leaderboardVisible?: boolean
    autoAssignLeads?: boolean
  }
  totalVisitor?: number
  isBlocked?: boolean
  storageUsedBytes?: number
  monthlyVisitorCount?: number
  visitorUsageMonth?: string
  createdAt?: Date
  updatedAt?: Date
}

export type IOrganizationFilter = {
  searchTerm?: string
  agencyType?: string
  status?: string
}

export type OrganizationModel = Model<IOrganization>
