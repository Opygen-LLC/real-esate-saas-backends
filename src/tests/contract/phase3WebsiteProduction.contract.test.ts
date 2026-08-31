import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Phase 3 production contract', () => {
  it('keeps public organization responses on one explicit canonical DTO', () => {
    const service = read('src/app/module/organization/organization.service.ts')
    expect(service).toMatch(/const getOrganizationByDomain[\s\S]*getPublicSiteInfo\(domainOrSubdomain\)/)
    expect(service).toMatch(/\.select\('organizationId agencyName agencyType licenseNumber email phone/)
    expect(service).not.toMatch(/\.select\('[^']*subscription[^']*'\)/)
    expect(service).toMatch(/socialLinks: canonicalSocialLinks/)
    expect(service).toMatch(/websiteSettings: canonicalWebsiteSettings/)
  })

  it('invalidates tenant website cache on settings changes and keeps preview reads tenant scoped', () => {
    const org = read('src/app/module/organization/organization.service.ts')
    const builder = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
    expect(org).toMatch(/updateWebsiteSettings[\s\S]*CacheInvalidationService\.invalidateTenant\(organizationId\)/)
    expect(builder).toMatch(/WebsitePage\.findOne\(\{ _id: preview\.pageId, organizationId: preview\.organizationId \}\)/)
  })

  it('uses escaped search terms across high traffic CRM/property services', () => {
    for (const file of ['property/property.service.ts', 'task/task.service.ts', 'viewing/viewing.service.ts', 'lead/lead.service.ts', 'organization/organization.service.ts', 'user/user.service.ts']) {
      const source = read(`src/app/module/${file}`)
      if (/searchTerm|search/i.test(source)) expect(source).toMatch(/safeRegexPattern|safeSearchRegex|exactCaseInsensitiveRegex/)
    }
  })

  it('keeps task/property tenant validation and targeted viewing conflict lookup', () => {
    const task = read('src/app/module/task/task.service.ts')
    const viewing = read('src/app/module/viewing/viewing.service.ts')
    expect(task).toMatch(/Property\.exists\(\{ _id: task\.linkedProperty, organizationId \}\)/)
    expect(viewing).toMatch(/Viewing\.findOne\(query\)/)
    expect(viewing).toMatch(/startTime:\{\$lt:endTime\}/)
    expect(viewing).toMatch(/endTime:\{\$gt:startTime\}/)
    expect(viewing).toMatch(/\$or:\[\{agentId\},\{propertyId\}\]/)
  })

  it('keeps Twitter migration lossless until the post-release removal window', () => {
    const phase2 = read('src/app/db/migrateWebsiteFooterPhase2.ts')
    const phase3 = read('src/app/db/reconcilePhase3ProductionData.ts')
    expect(phase2).toMatch(/legacyTwitterDeleted:\s*0/)
    expect(phase3).toMatch(/legacyTwitterDeleted:\s*0/)
    expect(phase3).toMatch(/dryRun/)
    expect(phase3).toMatch(/--confirm=phase3-production-reconciliation/)
  })
})
