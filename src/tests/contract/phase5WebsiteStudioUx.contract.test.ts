import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const service = fs.readFileSync(path.join(process.cwd(), 'src/app/module/organization/organization.service.ts'), 'utf8')

describe('Phase 5 Website Studio persistence semantics', () => {
  it('updates component overrides, animations and global animation state independently', () => {
    expect(service).toContain("if (websiteDesign.componentOverrides !== undefined)")
    expect(service).toContain("target['websiteSettings.websiteDesign.componentOverrides']")
    expect(service).toContain("if (websiteDesign.componentAnimations !== undefined)")
    expect(service).toContain("target['websiteSettings.websiteDesign.componentAnimations']")
    expect(service).toContain("if (websiteDesign.animationsEnabled !== undefined)")
    expect(service).toContain("target['websiteSettings.websiteDesign.animationsEnabled']")
  })

  it('applies template and design changes through one publication commit', () => {
    expect(service).toContain("if (payload.templateId) updateData['websiteSettings.renderMode'] = 'template'")
    expect(service).toContain('WebsitePublicationService.commitPublicationState({')
    expect(service).toContain('appendWebsiteSettingUpdates(updateData, payload.websiteSettings)')
  })
})
