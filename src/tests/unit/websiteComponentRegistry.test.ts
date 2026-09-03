import { describe, expect, it, vi } from 'vitest'
import { ComponentRegistry } from '../../app/module/websiteBuilder/componentRegistry'
import { EntitlementService } from '../../app/module/entitlement/entitlement.service'
import { WEBSITE_ANIMATION_PRESETS } from '../../app/module/websiteBuilder/websiteArchitecture.contract'

vi.mock('../../app/module/entitlement/entitlement.service', () => ({
  EntitlementService: { assertFeature: vi.fn(async () => undefined) },
}))

describe('Website Component Registry', () => {
  it('contains the complete Phase 7 independent component library with stable slot metadata', () => {
    const definitions = ComponentRegistry.list()
    expect(definitions).toHaveLength(78)
    expect(definitions.find((item) => item.id === 'hero.split-luxury.v1')?.slot).toBe('home.hero')
    expect(definitions.find((item) => item.id === 'properties.modern-grid.v1')?.slot).toBe('home.featuredProperties')
    expect(definitions.find((item) => item.id === 'footer.mega.v1')?.slot).toBe('shared.footer')
    expect(definitions.find((item) => item.id === 'why.icon-cards.v1')?.slot).toBe('home.whyChooseUs')
    expect(definitions.find((item) => item.id === 'reviews.three-cards.v1')?.slot).toBe('home.reviews')
    expect(definitions.find((item) => item.id === 'agents.portrait-cards.v1')?.slot).toBe('home.agents')
    expect(definitions.find((item) => item.id === 'consultation.split-lead-form.v1')?.slot).toBe('home.consultation')
    expect(definitions.find((item) => item.id === 'about.story.image-split.v1')?.slot).toBe('about.story')
    expect(definitions.find((item) => item.id === 'properties.filters.compact-bar.v1')?.slot).toBe('properties.filters')
    expect(definitions.find((item) => item.id === 'properties.card.modern.v1')?.slot).toBe('properties.card')
    expect(definitions.find((item) => item.id === 'properties.pagination.load-more.v1')?.slot).toBe('properties.pagination')
    expect(definitions.find((item) => item.id === 'agents.card.portrait.v1')?.slot).toBe('agents.card')
    expect(definitions.find((item) => item.id === 'agents.cta.brand.v1')?.slot).toBe('agents.cta')
    expect(definitions.find((item) => item.id === 'contact.form.card.v1')?.slot).toBe('contact.form')
    expect(definitions.find((item) => item.id === 'contact.map.directions.v1')?.slot).toBe('contact.map')
  })


  it('allows the curated Phase 4 animation set on every independent component design', () => {
    for (const definition of ComponentRegistry.list()) {
      expect(definition.supportedAnimations).toEqual([...WEBSITE_ANIMATION_PRESETS])
    }
  })

  it('rejects unknown components', () => {
    expect(() => ComponentRegistry.get('hero.unknown.v1')).toThrow(/Unknown website component/i)
  })

  it('rejects assigning a valid component to the wrong slot', async () => {
    await expect(ComponentRegistry.assertComponentForSlot('org_test', 'shared.header', 'hero.property-search.v1')).rejects.toThrow(/cannot be assigned/i)
  })

  it('enforces premiumTemplates for premium components', async () => {
    await ComponentRegistry.assertComponentForSlot('org_test', 'home.hero', 'hero.split-luxury.v1')
    expect(EntitlementService.assertFeature).toHaveBeenCalledWith('org_test', 'premiumTemplates')
  })
})
