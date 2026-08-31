import { describe, expect, it } from 'vitest'
import { sanitizeCustomCss } from '../../app/helpers/sanitize'
import { TemplateRegistry } from '../../app/module/websiteBuilder/templateRegistry'
import { WebsiteBuilderValidation } from '../../app/module/websiteBuilder/websiteBuilder.validation'

describe('Phase 4 website architecture behavior', () => {
  it('normalizes safe declaration-only custom CSS and rejects scope escapes', () => {
    expect(sanitizeCustomCss('box-shadow: 0 10px 20px rgba(0,0,0,.1); border-radius: 16px;')).toBe('box-shadow: 0 10px 20px rgba(0,0,0,.1); border-radius: 16px;')
    expect(() => sanitizeCustomCss('#other { color: red; }')).toThrow()
    expect(() => sanitizeCustomCss('@media (min-width: 1px) { color:red; }')).toThrow()
    expect(() => sanitizeCustomCss('position: fixed; top: 0;')).toThrow()
    expect(() => sanitizeCustomCss('background:url(javascript:alert(1));')).toThrow()
  })

  it('migrates legacy builder documents before current schema validation', () => {
    const legacy = {
      schemaVersion: 1,
      template: { id: 'template-1', version: '1.0.0' },
      pages: [{ id: 'home', slug: '/', title: 'Home', nodes: [{ id: 'h1', type: 'heading', props: { level: 1, text: 'Home' } }] }],
      theme: { primaryColor: '#111111', secondaryColor: '#222222', accentColor: '#333333', fontFamily: 'Inter' },
    }
    const migrated = TemplateRegistry.migrate(legacy)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.template.version).toBe('2.0.0')
    expect(WebsiteBuilderValidation.builderDocumentSchema.safeParse(migrated).success).toBe(true)
    expect(() => TemplateRegistry.assertCapabilities(migrated)).not.toThrow()
  })

  it('returns backend capabilities for all ten templates without a frontend fallback contract', () => {
    const registry = TemplateRegistry.list()
    expect(registry).toHaveLength(10)
    expect(registry.every((template) => template.capabilities.advancedBuilder)).toBe(true)
    expect(registry.find((template) => template.id === 'template-8')?.version).toBe('3.0.0')
    expect(registry.find((template) => template.id === 'template-10')?.capabilities.sections.consultation.supported).toBe(true)
  })
})
