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

/**
 * Slots supported by the composable-template foundation in Phase 1.
 * Keep this allow-list narrower than WEBSITE_SECTION_KEYS until a slot has a
 * stable component contract. This prevents clients from inventing slot names.
 */
export const WEBSITE_COMPONENT_SLOTS = [
  'shared.header',
  'shared.footer',
  'home.hero',
  'home.featuredProperties',
  'home.whyChooseUs',
  'home.reviews',
  'home.agents',
  'home.consultation',
] as const

export type WebsiteComponentSlot = (typeof WEBSITE_COMPONENT_SLOTS)[number]

export const WEBSITE_ANIMATION_PRESETS = [
  'none',
  'fade-in',
  'fade-up',
  'fade-down',
  'fade-left',
  'fade-right',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'zoom-in',
  'zoom-out',
  'blur-in',
  'reveal-up',
] as const
export type AnimationPreset = (typeof WEBSITE_ANIMATION_PRESETS)[number]

export const WEBSITE_ANIMATION_DURATIONS = ['fast', 'normal', 'slow'] as const
export type AnimationDuration = (typeof WEBSITE_ANIMATION_DURATIONS)[number]

export const WEBSITE_ANIMATION_DELAYS = [0, 100, 200, 300, 500] as const
export type AnimationDelay = (typeof WEBSITE_ANIMATION_DELAYS)[number]

export const WEBSITE_ANIMATION_TRIGGERS = ['page-load', 'viewport'] as const
export type AnimationTrigger = (typeof WEBSITE_ANIMATION_TRIGGERS)[number]

export type ComponentAnimationSettings = {
  enabled: boolean
  preset: AnimationPreset
  duration: AnimationDuration
  delay: AnimationDelay
  trigger: AnimationTrigger
  replay: boolean
}

export type WebsiteComponentOverrides = {
  shared?: {
    header?: string
    footer?: string
  }
  home?: {
    hero?: string
    featuredProperties?: string
    whyChooseUs?: string
    reviews?: string
    agents?: string
    consultation?: string
  }
}

export type WebsiteComponentAnimations = {
  shared?: {
    header?: ComponentAnimationSettings
    footer?: ComponentAnimationSettings
  }
  home?: {
    hero?: ComponentAnimationSettings
    featuredProperties?: ComponentAnimationSettings
    whyChooseUs?: ComponentAnimationSettings
    reviews?: ComponentAnimationSettings
    agents?: ComponentAnimationSettings
    consultation?: ComponentAnimationSettings
  }
}


export const WEBSITE_DESIGN_ACTIONS = [
  'SET_COMPONENT',
  'RESET_COMPONENT',
  'RESET_ALL_COMPONENTS',
  'SET_ANIMATION',
  'RESET_ANIMATION',
  'RESET_ALL_ANIMATIONS',
  'SET_ANIMATIONS_ENABLED',
  'APPLY_TEMPLATE',
  'APPLY_DESIGN',
] as const
export type WebsiteDesignActionName = (typeof WEBSITE_DESIGN_ACTIONS)[number]

type WebsiteDesignActionRevision = { expectedPublicationRevision?: number }

export type WebsiteDesignAction = WebsiteDesignActionRevision & (
  | { action: 'SET_COMPONENT'; slot: WebsiteComponentSlot; componentId: string }
  | { action: 'RESET_COMPONENT'; slot: WebsiteComponentSlot }
  | { action: 'RESET_ALL_COMPONENTS' }
  | { action: 'SET_ANIMATION'; slot: WebsiteComponentSlot; animation: ComponentAnimationSettings }
  | { action: 'RESET_ANIMATION'; slot: WebsiteComponentSlot }
  | { action: 'RESET_ALL_ANIMATIONS' }
  | { action: 'SET_ANIMATIONS_ENABLED'; enabled: boolean }
  | { action: 'APPLY_TEMPLATE'; templateId: WebsiteTemplateId; resetComponents?: boolean; keepAnimations?: boolean }
  | { action: 'APPLY_DESIGN'; design: WebsiteDesignContract; templateId?: WebsiteTemplateId }
)

export const WEBSITE_DESIGN_SCHEMA_VERSION = 1 as const
export type WebsiteDesignContract = {
  schemaVersion: typeof WEBSITE_DESIGN_SCHEMA_VERSION
  componentOverrides: WebsiteComponentOverrides
  componentAnimations: WebsiteComponentAnimations
  animationsEnabled: boolean
}

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
  design: WebsiteDesignContract
  visibility: { public: boolean }
}
