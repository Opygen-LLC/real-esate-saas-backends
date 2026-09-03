import { describe, expect, it } from 'vitest'
import { OrganizationValidation } from '../../app/module/organization/organization.validation'
import {
  WEBSITE_COMPONENT_SLOTS,
  WEBSITE_DESIGN_SCHEMA_VERSION,
} from '../../app/module/websiteBuilder/websiteArchitecture.contract'
import { WebsiteArchitectureService } from '../../app/module/websiteBuilder/websiteArchitecture.service'

const fadeUp = {
  enabled: true,
  preset: 'fade-up' as const,
  duration: 'normal' as const,
  delay: 100 as const,
  trigger: 'viewport' as const,
  replay: false,
}

describe('website design Phase 1 foundation', () => {
  it('defines only the initial composable slots and does not change render modes', () => {
    expect(WEBSITE_COMPONENT_SLOTS).toEqual([
      'shared.header',
      'shared.footer',
      'home.hero',
      'home.featuredProperties',
      'home.whyChooseUs',
      'home.reviews',
      'home.agents',
      'home.consultation',
    ])

    const template = WebsiteArchitectureService.toCanonicalWebsiteContract({ organizationId: 'org_1', templateId: 'template-3' })
    const builder = WebsiteArchitectureService.toCanonicalWebsiteContract({ organizationId: 'org_1', templateId: 'template-3', websiteSettings: { renderMode: 'builder' } })
    expect(template.renderMode).toBe('template')
    expect(builder.renderMode).toBe('builder')
  })

  it('assumes backward-compatible design defaults when legacy organizations have no design object', () => {
    const canonical = WebsiteArchitectureService.canonicalizeWebsiteDesign(undefined)
    expect(canonical).toEqual({
      schemaVersion: WEBSITE_DESIGN_SCHEMA_VERSION,
      componentOverrides: {},
      componentAnimations: {},
      animationsEnabled: true,
    })

    const website = WebsiteArchitectureService.toCanonicalWebsiteContract({ organizationId: 'org_legacy', templateId: 'template-3' })
    expect(website.templateId).toBe('template-3')
    expect(website.design).toEqual(canonical)
  })

  it('accepts versioned component overrides and controlled animation settings', () => {
    const result = OrganizationValidation.website.safeParse({
      body: {
        websiteSettings: {
          websiteDesign: {
            schemaVersion: 1,
            componentOverrides: {
              shared: { header: 'header.modern-glass.v1' },
              home: { hero: 'hero.split-luxury.v1' },
            },
            componentAnimations: {
              home: { hero: fadeUp },
            },
            animationsEnabled: false,
          },
        },
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects invented slots, unversioned component IDs and unsupported animation values', () => {
    expect(OrganizationValidation.website.safeParse({
      body: { websiteSettings: { websiteDesign: { componentOverrides: { home: { madeUpSection: 'hero.anything.v1' } } } } },
    }).success).toBe(false)

    expect(OrganizationValidation.website.safeParse({
      body: { websiteSettings: { websiteDesign: { componentOverrides: { home: { hero: 'hero-split-luxury' } } } } },
    }).success).toBe(false)

    expect(OrganizationValidation.website.safeParse({
      body: {
        websiteSettings: {
          websiteDesign: {
            componentAnimations: {
              home: { hero: { ...fadeUp, preset: 'spin-around' } },
            },
          },
        },
      },
    }).success).toBe(false)
  })

  it('normalizes stored nested design data without allowing arbitrary fields through', () => {
    const design = WebsiteArchitectureService.canonicalizeWebsiteDesign({
      schemaVersion: 999,
      componentOverrides: {
        shared: { header: ' header.modern-glass.v1 ', arbitrary: 'bad.component.v1' },
        home: { hero: 'hero.split-luxury.v1', unknown: 'bad.component.v1' },
      },
      componentAnimations: {
        home: { hero: fadeUp, unknown: fadeUp },
      },
      animationsEnabled: false,
      arbitrary: true,
    })

    expect(design).toEqual({
      schemaVersion: 1,
      componentOverrides: {
        shared: { header: 'header.modern-glass.v1' },
        home: { hero: 'hero.split-luxury.v1' },
      },
      componentAnimations: {
        home: { hero: fadeUp },
      },
      animationsEnabled: false,
    })
  })
})
