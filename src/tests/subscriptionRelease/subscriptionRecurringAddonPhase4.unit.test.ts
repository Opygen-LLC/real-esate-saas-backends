import { describe, expect, it } from 'vitest'
import {
  addonCapacityWithinLimit,
  applyCanonicalAddonCapacityWrite,
  resolveMaxAddonLeadCapacity,
} from '../../app/module/subscriptionPlan/planAddonCapacity'

describe('Phase 4 recurring lead add-on capacity', () => {
  it('resolves the canonical ceiling and preserves null as unlimited', () => {
    expect(resolveMaxAddonLeadCapacity({ maxAddonLeadCapacity: 2_000 })).toBe(2_000)
    expect(resolveMaxAddonLeadCapacity({ maxAddonLeadCapacity: null })).toBeNull()
  })

  it('falls back to the historical ceiling for grandfathered plan versions', () => {
    expect(resolveMaxAddonLeadCapacity({ maxRecurringLeadAddon: 1_500 })).toBe(1_500)
  })

  it('allows stacking the same capacity unit until the plan ceiling is reached', () => {
    expect(addonCapacityWithinLimit(0, 500, 2_000)).toBe(true)
    expect(addonCapacityWithinLimit(500, 500, 2_000)).toBe(true)
    expect(addonCapacityWithinLimit(1_500, 500, 2_000)).toBe(true)
    expect(addonCapacityWithinLimit(2_000, 500, 2_000)).toBe(false)
  })

  it('supports unlimited recurring add-on capacity', () => {
    expect(addonCapacityWithinLimit(50_000, 25_000, null)).toBe(true)
  })

  it('writes only the canonical field on new immutable versions', () => {
    const written = applyCanonicalAddonCapacityWrite({ maxRecurringLeadAddon: 2_000 }) as Record<string, unknown>
    expect(written.maxAddonLeadCapacity).toBe(2_000)
    expect(written).not.toHaveProperty('maxRecurringLeadAddon')
  })
})
