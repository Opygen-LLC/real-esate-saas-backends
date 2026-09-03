import { describe, expect, it, vi } from 'vitest'
import { ComponentRegistry } from '../../app/module/websiteBuilder/componentRegistry'
import { EntitlementService } from '../../app/module/entitlement/entitlement.service'

vi.mock('../../app/module/entitlement/entitlement.service', () => ({
  EntitlementService: { assertFeature: vi.fn(async () => undefined) },
}))

describe('Website Component Registry', () => {
  it('contains independent Phase 2 components with stable slot metadata', () => {
    const definitions = ComponentRegistry.list()
    expect(definitions).toHaveLength(9)
    expect(definitions.find((item) => item.id === 'hero.split-luxury.v1')?.slot).toBe('home.hero')
    expect(definitions.find((item) => item.id === 'properties.modern-grid.v1')?.slot).toBe('home.featuredProperties')
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
