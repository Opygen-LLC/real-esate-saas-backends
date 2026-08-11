import mongoose, { Model } from 'mongoose'

export interface ISubscription {
  plan: 'trial' | 'starter' | 'professional' | 'agency' | 'enterprise'
  status: 'active' | 'inactive' | 'expired'
  currentPeriodEnd: Date | null
  lastPaymentDate: Date | null
  maxProperties?: number
  maxAgents?: number
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
  totalVisitor?: number
  isBlocked?: boolean
  createdAt?: Date
  updatedAt?: Date
}

export type IOrganizationFilter = {
  searchTerm?: string
  agencyType?: string
  status?: string
}

export type OrganizationModel = Model<IOrganization>
