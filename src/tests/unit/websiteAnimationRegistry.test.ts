import { describe, expect, it } from 'vitest'
import { AnimationRegistry, WEBSITE_STAGGER_CAPABLE_SLOTS } from '../../app/module/websiteBuilder/animationRegistry'
import { WEBSITE_ANIMATION_PRESETS } from '../../app/module/websiteBuilder/websiteArchitecture.contract'

describe('Website Animation Registry', () => {
  it('publishes every controlled Phase 4 preset exactly once', () => {
    const definitions = AnimationRegistry.list()
    expect(definitions.map((item) => item.id)).toEqual([...WEBSITE_ANIMATION_PRESETS])
    expect(new Set(definitions.map((item) => item.id)).size).toBe(WEBSITE_ANIMATION_PRESETS.length)
  })

  it('keeps duration, delay, trigger and replay capabilities explicit', () => {
    const fadeUp = AnimationRegistry.get('fade-up')
    expect(fadeUp?.supportedDurations).toEqual(['fast', 'normal', 'slow'])
    expect(fadeUp?.supportedDelays).toEqual([0, 100, 200, 300, 500])
    expect(fadeUp?.supportedTriggers).toEqual(['page-load', 'viewport'])
    expect(fadeUp?.replaySupported).toBe(true)
    expect(AnimationRegistry.get('none')?.replaySupported).toBe(false)
  })

  it('prepares only repeatable collection slots for future child staggering', () => {
    expect(WEBSITE_STAGGER_CAPABLE_SLOTS).toEqual([
      'home.featuredProperties',
      'home.agents',
      'home.reviews',
    ])
  })
})
