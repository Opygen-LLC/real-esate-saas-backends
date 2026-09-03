import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const designService = fs.readFileSync(path.join(process.cwd(), 'src/app/module/websiteBuilder/websiteDesign.service.ts'), 'utf8')
const organizationService = fs.readFileSync(path.join(process.cwd(), 'src/app/module/organization/organization.service.ts'), 'utf8')

describe('Phase 5 Website Studio persistence semantics', () => {
  it('keeps component and animation reset behavior independent inside the controlled design service', () => {
    expect(designService).toContain("case 'RESET_ALL_COMPONENTS':")
    expect(designService).toContain('design.componentOverrides = {}')
    expect(designService).toContain("case 'RESET_ALL_ANIMATIONS':")
    expect(designService).toContain('design.componentAnimations = {}')
    expect(designService).toContain("case 'SET_ANIMATIONS_ENABLED':")
    expect(designService).toContain('design.animationsEnabled = action.enabled')
  })

  it('routes template plus design mutations through one publication commit and blocks legacy bypasses', () => {
    expect(designService).toContain("case 'APPLY_DESIGN':")
    expect(designService).toContain("'websiteSettings.websiteDesign': next.design")
    expect(designService).toContain('WebsitePublicationService.commitPublicationState({')
    expect(organizationService).toContain('Use controlled /organization/website/design API')
  })
})
