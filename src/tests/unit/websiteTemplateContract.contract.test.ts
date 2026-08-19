import { describe, expect, it } from 'vitest'
import { OrganizationValidation } from '../../app/module/organization/organization.validation'
import { TemplateRegistry } from '../../app/module/websiteBuilder/templateRegistry'
import { builderDocumentSchema } from '../../app/module/websiteBuilder/websiteBuilder.validation'
import { WEBSITE_TEMPLATE_IDS } from '../../app/module/websiteBuilder/websiteTemplate.constants'

const minimalBuilderDocument = (templateId: (typeof WEBSITE_TEMPLATE_IDS)[number]) => ({
  schemaVersion: 2 as const,
  template: { id: templateId, version: '2.0.0' },
  pages: [{ id: 'home', slug: '/', title: 'Home', nodes: [] }],
  theme: {
    primaryColor: '#0f172a',
    secondaryColor: '#2563eb',
    accentColor: '#7c3aed',
    fontFamily: 'Inter',
  },
})

describe('website template contract', () => {
  it('accepts every registered template in website settings and onboarding', () => {
    for (const templateId of WEBSITE_TEMPLATE_IDS) {
      expect(OrganizationValidation.website.safeParse({ body: { templateId } }).success).toBe(true)
      expect(OrganizationValidation.onboarding.safeParse({ body: { templateId } }).success).toBe(true)
    }
  })

  it('accepts every registered template in builder documents', () => {
    for (const templateId of WEBSITE_TEMPLATE_IDS) {
      expect(builderDocumentSchema.safeParse(minimalBuilderDocument(templateId)).success).toBe(true)
    }
  })

  it('keeps the registry aligned with the canonical template ids', () => {
    expect(TemplateRegistry.list().map((template) => template.id)).toEqual([...WEBSITE_TEMPLATE_IDS])
    expect(TemplateRegistry.get('template-5').tier).toBe('free')
    expect(TemplateRegistry.get('template-6').tier).toBe('premium')
    expect(TemplateRegistry.get('template-7').tier).toBe('free')
  })
})
