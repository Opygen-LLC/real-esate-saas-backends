import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Phase 4 website architecture contract', () => {
  it('uses one canonical publication contract for template and builder modes', () => {
    const contract = read('src/app/module/websiteBuilder/websiteArchitecture.contract.ts')
    const publication = read('src/app/module/websiteBuilder/websitePublication.service.ts')
    const organization = read('src/app/module/organization/organization.service.ts')
    const builder = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
    expect(contract).toContain("'template'")
    expect(contract).toContain("'builder'")
    expect(contract).toContain('WebsiteSectionStyles')
    expect(contract).toContain('CanonicalWebsiteContract')
    expect(publication).toMatch(/\$inc:\s*\{\s*'websiteSettings\.publicationRevision':\s*1/)
    expect(publication).toContain('CacheInvalidationService.invalidateTenant(organizationId)')
    expect(organization).toMatch(/WebsitePublicationService\.commitPublicationState\([\s\S]*renderMode,/)
    expect(builder).toMatch(/WebsitePublicationService\.commitPublicationState\([\s\S]*renderMode:\s*'builder'/)
    expect(organization).toMatch(/currentWebsite\.websiteSettings\?\.renderMode === 'builder'/)
    expect(organization).toContain("eventType: 'website.branding_published'")
  })

  it('restores revisions only after migration, validation, capability and entitlement checks', () => {
    const builder = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
    const restore = builder.slice(builder.indexOf('const restoreRevision'), builder.indexOf('const createPreviewToken'))
    expect(restore).toContain('prepareBuilderDocument(revision.document)')
    expect(restore).toContain('TemplateRegistry.assertEntitlement(organizationId, document)')
    expect(restore).toMatch(/findOneAndUpdate\(\s*\{ _id: pageId, organizationId \}/)
    expect(builder).toContain('schemaVersion: Number(document.schemaVersion || 2)')
  })

  it('does not publish preview requests and invalidates caches only through publication', () => {
    const builder = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
    const preview = builder.slice(builder.indexOf('const createPreviewToken'), builder.indexOf('type AssetLifecycleOptions'))
    expect(preview).not.toContain('WebsitePublicationService.commitPublicationState')
    expect(preview).not.toContain('WebsitePublicationService.afterPublication')
    expect(preview).toContain('draftDocument')
  })

  it('declares all ten templates explicitly Advanced Builder supported', () => {
    const registry = read('src/app/module/websiteBuilder/templateRegistry.ts')
    for (let id = 1; id <= 10; id += 1) {
      expect(registry).toMatch(new RegExp(`id: 'template-${id}'[\\s\\S]{0,1200}?advancedBuilder: true`))
    }
  })
})
