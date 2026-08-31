import type { WebsiteTemplateId } from '../websiteBuilder/websiteTemplate.constants'
import type { CanonicalWebsiteContract, WebsiteRenderMode, WebsiteSectionStyles as CanonicalWebsiteSectionStyles } from '../websiteBuilder/websiteArchitecture.contract'
export { WEBSITE_SECTION_KEYS } from '../websiteBuilder/websiteArchitecture.contract'
export type { WebsiteSectionKey, WebsiteSectionStyle, WebsiteSectionStyles } from '../websiteBuilder/websiteArchitecture.contract'

export type OrganizationSocialLinks = {
  facebook?: string
  instagram?: string
  youtube?: string
  x?: string
  whatsapp?: string
  linkedin?: string
  /** @deprecated Legacy read-only compatibility. New writes are canonicalized to x. */
  twitter?: string
}

export type WebsiteSocialVisibility = {
  facebook?: boolean
  instagram?: boolean
  youtube?: boolean
  x?: boolean
}

export type WebsiteFooterSettings = {
  showSocialLinks?: boolean
  socialVisibility?: WebsiteSocialVisibility
}

export type OrganizationWebsiteSettings = {
  heroTitle?: string
  heroSubtitle?: string
  heroImage?: string
  featuredPropertiesCount?: number
  enableTestimonials?: boolean
  enableLeadForm?: boolean
  enableWhatsAppChat?: boolean
  renderMode?: WebsiteRenderMode
  content?: Record<string, unknown>
  sectionStyles?: CanonicalWebsiteSectionStyles
  footer?: WebsiteFooterSettings
  publicationRevision?: number
  lastPublishedAt?: Date | string | null
}

export type PublicSiteStats = {
  totalProperties: number
  totalAgents: number
}

export type PublicOrganizationWebsite = {
  organizationId: string
  agencyName: string
  agencyType: string
  licenseNumber?: string
  email: string
  phone: string
  address?: string
  city?: string
  state?: string
  country?: string
  zipCode?: string
  defaultLanguage?: 'en' | 'bn'
  addressDetails?: Record<string, string>
  areaConversion?: { kathaSqft?: number; bighaKatha?: number }
  serviceAreas?: Array<string | { city: string; state?: string; country?: string; zipCodes?: string[] }>
  logo?: string
  favicon?: string
  primaryColor?: string
  secondaryColor?: string
  metaTitle?: string
  metaDescription?: string
  sub_domain?: string
  domain?: string
  templateId?: WebsiteTemplateId
  configuredTemplateId?: WebsiteTemplateId
  font?: string
  socialLinks?: Omit<OrganizationSocialLinks, 'twitter'>
  websiteSettings?: OrganizationWebsiteSettings
  brandingVersion?: string
  stats: PublicSiteStats
  website?: CanonicalWebsiteContract
}
