import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { EntitlementService } from '../entitlement/entitlement.service'
import {
  WEBSITE_COMPONENT_SLOTS,
  type AnimationPreset,
  type WebsiteComponentOverrides,
  type WebsiteComponentSlot,
} from './websiteArchitecture.contract'

export type WebsiteComponentCategory = 'header' | 'hero' | 'featured-properties'
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
const HEADER_ANIMATIONS = ['none', 'fade-in', 'fade-down', 'slide-down', 'blur-in'] as const satisfies readonly AnimationPreset[]

const registry = [
  {
    id: 'header.modern-glass.v1',
    name: 'Modern Glass',
    slot: 'shared.header',
    category: 'header',
    version: 1,
    status: 'ACTIVE',
    tier: 'PREMIUM',
    entitlement: 'premiumTemplates',
    description: 'Independent floating glass navigation with responsive agency actions.',
    thumbnail: null,
    supportedAnimations: HEADER_ANIMATIONS,
  },
  {
    id: 'header.luxury-centered.v1',
    name: 'Luxury Centered',
    slot: 'shared.header',
    category: 'header',
    version: 1,
    status: 'ACTIVE',
    tier: 'PREMIUM',
    entitlement: 'premiumTemplates',
    description: 'Centered editorial navigation designed for premium real-estate brands.',
    thumbnail: null,
    supportedAnimations: HEADER_ANIMATIONS,
  },
  {
    id: 'header.corporate-split.v1',
    name: 'Corporate Split',
    slot: 'shared.header',
    category: 'header',
    version: 1,
    status: 'ACTIVE',
    tier: 'FREE',
    entitlement: 'included',
    description: 'Structured brokerage header with contact-first navigation.',
    thumbnail: null,
    supportedAnimations: HEADER_ANIMATIONS,
  },
  {
    id: 'hero.property-search.v1',
    name: 'Property Search',
    slot: 'home.hero',
    category: 'hero',
    version: 1,
    status: 'ACTIVE',
    tier: 'FREE',
    entitlement: 'included',
    description: 'Search-led independent hero focused on fast property discovery.',
    thumbnail: null,
    supportedAnimations: COMMON_ENTRANCE_ANIMATIONS,
  },
  {
    id: 'hero.split-luxury.v1',
    name: 'Luxury Split',
    slot: 'home.hero',
    category: 'hero',
    version: 1,
    status: 'ACTIVE',
    tier: 'PREMIUM',
    entitlement: 'premiumTemplates',
    description: 'Editorial split-screen hero with cinematic property media.',
    thumbnail: null,
    supportedAnimations: COMMON_ENTRANCE_ANIMATIONS,
  },
  {
    id: 'hero.editorial-fullscreen.v1',
    name: 'Editorial Fullscreen',
    slot: 'home.hero',
    category: 'hero',
    version: 1,
    status: 'ACTIVE',
    tier: 'PREMIUM',
    entitlement: 'premiumTemplates',
    description: 'Fullscreen image-first hero with restrained editorial typography.',
    thumbnail: null,
    supportedAnimations: COMMON_ENTRANCE_ANIMATIONS,
  },
  {
    id: 'properties.modern-grid.v1',
    name: 'Modern Grid',
    slot: 'home.featuredProperties',
    category: 'featured-properties',
    version: 1,
    status: 'ACTIVE',
    tier: 'FREE',
    entitlement: 'included',
    description: 'Responsive independent property-card grid.',
    thumbnail: null,
    supportedAnimations: COMMON_ENTRANCE_ANIMATIONS,
  },
  {
    id: 'properties.editorial.v1',
    name: 'Editorial Properties',
    slot: 'home.featuredProperties',
    category: 'featured-properties',
    version: 1,
    status: 'ACTIVE',
    tier: 'PREMIUM',
    entitlement: 'premiumTemplates',
    description: 'Image-led editorial presentation for selected properties.',
    thumbnail: null,
    supportedAnimations: COMMON_ENTRANCE_ANIMATIONS,
  },
  {
    id: 'properties.horizontal-carousel.v1',
    name: 'Horizontal Collection',
    slot: 'home.featuredProperties',
    category: 'featured-properties',
    version: 1,
    status: 'ACTIVE',
    tier: 'FREE',
    entitlement: 'included',
    description: 'Horizontally scrollable property collection optimized for touch devices.',
    thumbnail: null,
    supportedAnimations: COMMON_ENTRANCE_ANIMATIONS,
  },
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
  assertComponentForSlot,
  assertOverrides,
  isPremium: (id: string): boolean => registryById.get(id)?.tier === 'PREMIUM',
  supportsSlot: (id: string, slot: WebsiteComponentSlot): boolean => registryById.get(id)?.slot === slot,
}
