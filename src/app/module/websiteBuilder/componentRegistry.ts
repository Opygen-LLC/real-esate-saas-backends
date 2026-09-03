import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { EntitlementService } from '../entitlement/entitlement.service'
import {
  WEBSITE_COMPONENT_SLOTS,
  type AnimationPreset,
  type WebsiteComponentOverrides,
  type WebsiteComponentSlot,
} from './websiteArchitecture.contract'

export type WebsiteComponentCategory = 'header' | 'footer' | 'hero' | 'featured-properties' | 'why-choose-us' | 'reviews' | 'agents' | 'consultation'
export type WebsiteComponentStatus = 'ACTIVE' | 'INACTIVE'
export type WebsiteComponentTier = 'FREE' | 'PREMIUM'
export type WebsiteComponentEntitlement = 'included' | 'premiumTemplates'

export type WebsiteComponentDefinition = {
  id: string
  name: string
  slot: WebsiteComponentSlot
  category: WebsiteComponentCategory
  version: number
  status: WebsiteComponentStatus
  tier: WebsiteComponentTier
  entitlement: WebsiteComponentEntitlement
  description: string
  thumbnail: string | null
  supportedAnimations: readonly AnimationPreset[]
}

const COMMON_ENTRANCE_ANIMATIONS = ['none', 'fade-in', 'fade-up', 'fade-down', 'fade-left', 'fade-right', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom-in', 'zoom-out', 'blur-in', 'reveal-up'] as const satisfies readonly AnimationPreset[]
const registry = [
  { id: 'header.modern-glass.v1', name: 'Modern Glass', slot: 'shared.header', category: 'header', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Independent floating glass navigation with responsive agency actions.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'header.luxury-centered.v1', name: 'Luxury Centered', slot: 'shared.header', category: 'header', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Centered editorial navigation designed for premium real-estate brands.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'header.corporate-split.v1', name: 'Corporate Split', slot: 'shared.header', category: 'header', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Structured brokerage header with contact-first navigation.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'footer.mega.v1', name: 'Mega Footer', slot: 'shared.footer', category: 'footer', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Large multi-column agency footer with navigation, contact details and social links.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'footer.minimal.v1', name: 'Minimal Footer', slot: 'shared.footer', category: 'footer', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Compact navigation-first footer for clean contemporary websites.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'footer.luxury-centered.v1', name: 'Luxury Centered Footer', slot: 'shared.footer', category: 'footer', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Centered editorial footer for premium residential brands.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'hero.property-search.v1', name: 'Property Search', slot: 'home.hero', category: 'hero', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Search-led independent hero focused on fast property discovery.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'hero.split-luxury.v1', name: 'Luxury Split', slot: 'home.hero', category: 'hero', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Editorial split-screen hero with cinematic property media.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'hero.editorial-fullscreen.v1', name: 'Editorial Fullscreen', slot: 'home.hero', category: 'hero', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Fullscreen image-first hero with restrained editorial typography.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.modern-grid.v1', name: 'Modern Grid', slot: 'home.featuredProperties', category: 'featured-properties', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Responsive independent property-card grid using canonical public property presentation.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.editorial.v1', name: 'Editorial Properties', slot: 'home.featuredProperties', category: 'featured-properties', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Image-led editorial presentation using canonical public property presentation.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'properties.horizontal-carousel.v1', name: 'Horizontal Collection', slot: 'home.featuredProperties', category: 'featured-properties', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Touch-friendly horizontal property collection using canonical public property presentation.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'why.icon-cards.v1', name: 'Icon Cards', slot: 'home.whyChooseUs', category: 'why-choose-us', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Four-card trust and service presentation using website content features.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'why.image-statistics.v1', name: 'Image + Statistics', slot: 'home.whyChooseUs', category: 'why-choose-us', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Image-led agency value proposition paired with website statistics.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'why.numbered-editorial.v1', name: 'Numbered Editorial', slot: 'home.whyChooseUs', category: 'why-choose-us', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Editorial numbered list for a structured premium agency story.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'reviews.three-cards.v1', name: 'Three Review Cards', slot: 'home.reviews', category: 'reviews', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Three-card review layout rendered only from published public reviews.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'reviews.testimonial-slider.v1', name: 'Large Testimonial Slider', slot: 'home.reviews', category: 'reviews', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Large editorial testimonial slider rendered only from published public reviews.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'reviews.rating-summary.v1', name: 'Rating Summary + Reviews', slot: 'home.reviews', category: 'reviews', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Average rating summary with recent published client reviews.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.portrait-cards.v1', name: 'Portrait Cards', slot: 'home.agents', category: 'agents', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Portrait agent cards with direct contact actions.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.editorial-split.v1', name: 'Editorial Split', slot: 'home.agents', category: 'agents', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Editorial team composition with a lead advisor focus.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'agents.minimal-profiles.v1', name: 'Minimal Profiles', slot: 'home.agents', category: 'agents', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Compact advisor directory for restrained website designs.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'consultation.background-image.v1', name: 'Background Image CTA', slot: 'home.consultation', category: 'consultation', version: 1, status: 'ACTIVE', tier: 'PREMIUM', entitlement: 'premiumTemplates', description: 'Cinematic inquiry CTA with a canonical public lead submission form.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'consultation.minimal-brand.v1', name: 'Minimal Brand CTA', slot: 'home.consultation', category: 'consultation', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Brand-color consultation block with compact canonical lead capture.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
  { id: 'consultation.split-lead-form.v1', name: 'Split Lead Form', slot: 'home.consultation', category: 'consultation', version: 1, status: 'ACTIVE', tier: 'FREE', entitlement: 'included', description: 'Split information and lead form layout that preserves the existing public CRM capture flow.', thumbnail: null, supportedAnimations: COMMON_ENTRANCE_ANIMATIONS },
] as const satisfies readonly WebsiteComponentDefinition[]

const registryById = new Map<string, WebsiteComponentDefinition>(registry.map((definition) => [definition.id, definition]))

const readOverride = (overrides: WebsiteComponentOverrides | undefined, slot: WebsiteComponentSlot): string | undefined => {
  if (!overrides) return undefined
  const [group, key] = slot.split('.', 2)
  return (overrides as Record<string, Record<string, string> | undefined>)[group]?.[key]
}

const get = (id: string): WebsiteComponentDefinition => {
  const definition = registryById.get(id)
  if (!definition) throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown website component')
  return definition
}

const assertComponentForSlot = async (organizationId: string, slot: WebsiteComponentSlot, componentId: string): Promise<WebsiteComponentDefinition> => {
  const definition = get(componentId)
  if (definition.slot !== slot) {
    throw new ApiError(httpStatus.BAD_REQUEST, `${definition.name} cannot be assigned to ${slot}`)
  }
  if (definition.status !== 'ACTIVE') {
    throw new ApiError(httpStatus.BAD_REQUEST, `${definition.name} is not currently available`)
  }
  if (definition.entitlement === 'premiumTemplates') {
    await EntitlementService.assertFeature(organizationId, 'premiumTemplates')
  }
  return definition
}

const assertOverrides = async (organizationId: string, overrides?: WebsiteComponentOverrides): Promise<void> => {
  for (const slot of WEBSITE_COMPONENT_SLOTS) {
    const componentId = readOverride(overrides, slot)
    if (componentId) await assertComponentForSlot(organizationId, slot, componentId)
  }
}

export const ComponentRegistry = {
  list: (): WebsiteComponentDefinition[] => registry.map((definition) => ({ ...definition })),
  get,
  find: (id: string): WebsiteComponentDefinition | undefined => registryById.get(id),
  assertComponentForSlot,
  assertOverrides,
  isPremium: (id: string): boolean => registryById.get(id)?.tier === 'PREMIUM',
  supportsSlot: (id: string, slot: WebsiteComponentSlot): boolean => registryById.get(id)?.slot === slot,
  isEffectiveForAccess: (id: string, premiumTemplates: boolean): boolean => {
    const definition = registryById.get(id)
    if (!definition || definition.status !== 'ACTIVE') return false
    return definition.entitlement !== 'premiumTemplates' || premiumTemplates
  },
}
