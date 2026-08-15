import { describe, expect, it } from 'vitest'
import { normalizePropertyMediaLink, normalizePropertyMediaLinks } from '../../app/module/property/propertyMedia.service'
import { PropertyValidation } from '../../app/module/property/property.validation'

describe('phase 4 property media contracts', () => {
  it('generates trusted YouTube and Vimeo embed URLs server-side', () => {
    const youtube = normalizePropertyMediaLink({ id: 'yt', url: 'https://youtu.be/dQw4w9WgXcQ', type: 'video', isHero: true })
    expect(youtube.provider).toBe('youtube')
    expect(youtube.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0')

    const vimeo = normalizePropertyMediaLink({ id: 'vi', url: 'https://vimeo.com/76979871', type: 'video' })
    expect(vimeo.provider).toBe('vimeo')
    expect(vimeo.embedUrl).toBe('https://player.vimeo.com/video/76979871')
  })

  it('normalizes Matterport and Kuula tours and rejects arbitrary hero hosts', () => {
    const matterport = normalizePropertyMediaLink({ id: 'mp', url: 'https://my.matterport.com/show/?m=SxQL3iGyoDo', type: 'video', isHero: true })
    expect(matterport.provider).toBe('matterport')
    expect(matterport.type).toBe('virtual_tour')
    expect(matterport.embedUrl).toContain('https://my.matterport.com/show/?m=SxQL3iGyoDo')

    const kuula = normalizePropertyMediaLink({ id: 'ku', url: 'https://kuula.co/share/collection7', type: 'video' })
    expect(kuula.provider).toBe('kuula')
    expect(kuula.type).toBe('360')
    expect(kuula.embedUrl).toContain('https://kuula.co/share/collection7')

    expect(() => normalizePropertyMediaLink({ id: 'bad', url: 'https://example.com/tour', type: '360', isHero: true })).toThrow(/hero/i)
  })

  it('does not trust a client-supplied provider or embed URL', () => {
    const media = normalizePropertyMediaLink({
      id: 'spoof',
      url: 'https://example.com/not-youtube',
      provider: 'youtube',
      type: 'video',
      embedUrl: 'https://www.youtube.com/embed/attacker-controlled',
      isHero: false,
    })
    expect(media.provider).toBe('other')
    expect(media.embedUrl).toBeUndefined()
  })

  it('allows one hero and rejects duplicate IDs or more than ten links', () => {
    expect(() => normalizePropertyMediaLinks([
      { id: 'same', url: 'https://youtu.be/dQw4w9WgXcQ', type: 'video' },
      { id: 'same', url: 'https://vimeo.com/76979871', type: 'video' },
    ])).toThrow(/unique/i)
    expect(() => normalizePropertyMediaLinks(Array.from({ length: 11 }, (_, index) => ({ id: `m-${index}`, url: `https://example.com/${index}`, type: 'video' as const })))).toThrow(/up to 10/i)
  })

  it('enforces a maximum of 20 property photos at the API contract', () => {
    const image = { url: 'https://media.example.com/a.webp' }
    const twenty = PropertyValidation.updatePropertyZodSchema.safeParse({ body: { images: Array.from({ length: 20 }, () => image) } })
    const twentyOne = PropertyValidation.updatePropertyZodSchema.safeParse({ body: { images: Array.from({ length: 21 }, () => image) } })
    expect(twenty.success).toBe(true)
    expect(twentyOne.success).toBe(false)
  })
})
