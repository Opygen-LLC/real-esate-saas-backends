import type { WebsiteTemplateId } from './websiteTemplate.constants'

export const WEBSITE_RENDER_MODES = ['template', 'builder'] as const
export type WebsiteRenderMode = (typeof WEBSITE_RENDER_MODES)[number]

export const WEBSITE_SECTION_KEYS = [
  'shared.header',
  'shared.footer',
  'home.hero',
  'home.trustPoints',
  'home.featuredProperties',
  'home.whyChooseUs',
  'home.reviews',
  'home.agents',
  'home.consultation',
  'about.hero',
  'about.story',
  'about.values',
  'about.stats',
  'about.cta',
  'properties.hero',
  'properties.listing',
  'agents.hero',
  'agents.listing',
  'contact.hero',
  'contact.office',
  'contact.form',
] as const

export type WebsiteSectionKey = (typeof WEBSITE_SECTION_KEYS)[number]
export type WebsiteSectionStyle = { backgroundColor?: string; textColor?: string }
export type WebsiteSectionStyles = Partial<Record<WebsiteSectionKey, WebsiteSectionStyle>>

export type WebsiteTemplateSectionCapability = { supported: boolean; label: string; required?: boolean }
export type WebsiteTemplateCapabilities = {
  hero: { backgroundImage: boolean; eyebrow: boolean; title: boolean; subtitle: boolean }
  sections: {
    featuredProperties: WebsiteTemplateSectionCapability
    whyChooseUs: WebsiteTemplateSectionCapability
    agents: WebsiteTemplateSectionCapability
    consultation: WebsiteTemplateSectionCapability
  }
  advancedBuilder: boolean
}

export type WebsitePublicationContract = {
  status: 'provisioned' | 'published' | 'suspended'
  revision: number
  lastPublishedAt?: string | null
}

export type CanonicalWebsiteContract = {
  schemaVersion: 1
  organizationId: string
  renderMode: WebsiteRenderMode
  templateId: WebsiteTemplateId
  branding: {
    logo?: string
    favicon?: string
    primaryColor?: string
    secondaryColor?: string
    font?: string
  }
  seo: {
    title?: string
    description?: string
  }
  domain: {
    subdomain?: string
    customDomain?: string
    customDomainVerified?: boolean
  }
  publishing: WebsitePublicationContract
  sectionStyles: WebsiteSectionStyles
  visibility: { public: boolean }
}
