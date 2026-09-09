import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BannerValidation } from '../../app/module/banner/banner.validation'
import { LandingPageValidation } from '../../app/module/landingPage/landingPage.validation'
import { SectionValidation } from '../../app/module/section/section.validation'

const root = path.resolve(__dirname, '../../..')
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('phase 3 legacy website-content hardening', () => {
  it('filters public reads to active content and serializes an explicit public projection', () => {
    for (const relative of [
      'src/app/module/banner/banner.controller.ts',
      'src/app/module/section/section.controller.ts',
      'src/app/module/landingPage/landingPage.controller.ts',
    ]) {
      const source = read(relative)
      expect(source, relative).toMatch(/status:\s*true/)
      expect(source, relative).toMatch(/serializePublic/)
      expect(source, relative).toMatch(/\.select\(/)
    }
  })

  it('rejects tenant/internal fields and unsafe URLs/content at the request contract', () => {
    expect(() => BannerValidation.create.parse({ body: { title: 'Hero', image: 'javascript:alert(1)', organizationId: 'org-b' } })).toThrow()
    expect(() => BannerValidation.create.parse({ body: { title: 'Hero', image: 'https://cdn.example.test/hero.jpg', organizationId: 'org-b' } })).toThrow()
    expect(() => SectionValidation.create.parse({ body: { name: 'Hero', title: 'Hero', content: { html: '<script>alert(1)</script>' } } })).toThrow()
    expect(() => LandingPageValidation.create.parse({ body: { title: 'Page', slug: 'valid-page', organizationId: 'org-b' } })).toThrow()
  })

  it('requires request validation on all legacy website-content writes', () => {
    for (const relative of [
      'src/app/module/banner/banner.route.ts',
      'src/app/module/section/section.route.ts',
      'src/app/module/landingPage/landingPage.route.ts',
    ]) {
      const source = read(relative)
      expect(source, relative).toMatch(/router\.post[\s\S]*validateRequest/)
      expect(source, relative).toMatch(/router\.patch[\s\S]*validateRequest/)
      expect(source, relative).toMatch(/router\.delete[\s\S]*validateRequest/)
    }
  })
})
