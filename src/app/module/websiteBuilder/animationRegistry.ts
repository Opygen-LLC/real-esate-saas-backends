import {
  WEBSITE_ANIMATION_DELAYS,
  WEBSITE_ANIMATION_DURATIONS,
  WEBSITE_ANIMATION_PRESETS,
  WEBSITE_ANIMATION_TRIGGERS,
  type AnimationDelay,
  type AnimationDuration,
  type AnimationPreset,
  type AnimationTrigger,
  type WebsiteComponentSlot,
} from './websiteArchitecture.contract'

export type WebsiteAnimationCategory = 'none' | 'fade' | 'slide' | 'zoom' | 'reveal'

export type WebsiteAnimationDefinition = {
  id: AnimationPreset
  name: string
  category: WebsiteAnimationCategory
  status: 'ACTIVE'
  supportedDurations: readonly AnimationDuration[]
  supportedDelays: readonly AnimationDelay[]
  supportedTriggers: readonly AnimationTrigger[]
  replaySupported: boolean
}

const definition = (id: AnimationPreset, name: string, category: WebsiteAnimationCategory): WebsiteAnimationDefinition => ({
  id,
  name,
  category,
  status: 'ACTIVE',
  supportedDurations: WEBSITE_ANIMATION_DURATIONS,
  supportedDelays: WEBSITE_ANIMATION_DELAYS,
  supportedTriggers: WEBSITE_ANIMATION_TRIGGERS,
  replaySupported: id !== 'none',
})

const registry: readonly WebsiteAnimationDefinition[] = [
  definition('none', 'None', 'none'),
  definition('fade-in', 'Fade In', 'fade'),
  definition('fade-up', 'Fade Up', 'fade'),
  definition('fade-down', 'Fade Down', 'fade'),
  definition('fade-left', 'Fade Left', 'fade'),
  definition('fade-right', 'Fade Right', 'fade'),
  definition('slide-up', 'Slide Up', 'slide'),
  definition('slide-down', 'Slide Down', 'slide'),
  definition('slide-left', 'Slide Left', 'slide'),
  definition('slide-right', 'Slide Right', 'slide'),
  definition('zoom-in', 'Zoom In', 'zoom'),
  definition('zoom-out', 'Zoom Out', 'zoom'),
  definition('blur-in', 'Blur In', 'reveal'),
  definition('reveal-up', 'Reveal Up', 'reveal'),
]

const registryById = new Map<AnimationPreset, WebsiteAnimationDefinition>(registry.map((item) => [item.id, item]))

/** Prepared for child-level stagger support without changing the persisted Phase 1 contract. */
export const WEBSITE_STAGGER_CAPABLE_SLOTS = [
  'home.featuredProperties',
  'home.agents',
  'home.reviews',
] as const satisfies readonly WebsiteComponentSlot[]

export const AnimationRegistry = {
  list: (): WebsiteAnimationDefinition[] => registry.map((item) => ({ ...item })),
  get: (id: AnimationPreset): WebsiteAnimationDefinition | undefined => registryById.get(id),
  has: (id: string): id is AnimationPreset => (WEBSITE_ANIMATION_PRESETS as readonly string[]).includes(id),
  staggerCapableSlots: (): WebsiteComponentSlot[] => [...WEBSITE_STAGGER_CAPABLE_SLOTS],
}
