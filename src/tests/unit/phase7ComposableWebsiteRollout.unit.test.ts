import { describe, expect, it } from 'vitest'
import { ComponentRegistry } from '../../app/module/websiteBuilder/componentRegistry'
import { AnimationRegistry } from '../../app/module/websiteBuilder/animationRegistry'
import { WEBSITE_COMPONENT_SLOTS } from '../../app/module/websiteBuilder/websiteArchitecture.contract'

const phase7Slots = [
  'about.hero', 'about.story', 'about.values', 'about.stats', 'about.cta',
  'properties.hero', 'properties.listing', 'properties.filters', 'properties.card', 'properties.pagination',
  'agents.hero', 'agents.listing', 'agents.card', 'agents.cta',
  'contact.hero', 'contact.office', 'contact.form', 'contact.map',
] as const

describe('Phase 7 composable website rollout', () => {
  it('registers all 26 stable slots and exactly three variants for every Phase 7 slot', () => {
    expect(WEBSITE_COMPONENT_SLOTS).toHaveLength(26)
    const definitions = ComponentRegistry.list()
    expect(definitions).toHaveLength(78)
    for (const slot of phase7Slots) {
      expect(definitions.filter((definition) => definition.slot === slot)).toHaveLength(3)
    }
  })

  it('keeps every registered component active on exactly one valid slot with controlled animations', () => {
    const slots = new Set(WEBSITE_COMPONENT_SLOTS)
    for (const definition of ComponentRegistry.list()) {
      expect(slots.has(definition.slot)).toBe(true)
      expect(definition.status).toBe('ACTIVE')
      expect(definition.id).toMatch(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\.v[1-9]\d*$/)
      expect(definition.supportedAnimations.length).toBeGreaterThan(0)
    }
  })

  it('prepares repeating list/card slots for future stagger without changing the persisted animation contract', () => {
    for (const slot of ['home.featuredProperties', 'home.reviews', 'home.agents', 'about.values', 'properties.listing', 'properties.card', 'agents.listing', 'agents.card'] as const) {
      expect(AnimationRegistry.isStaggerCapableSlot(slot)).toBe(true)
    }
  })
})
