import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

const tenantAccess = read('src/app/module/tenantAccess/tenantAccess.service.ts')
const domainService = read('src/app/module/domain/domain.service.ts')
const organizationService = read('src/app/module/organization/organization.service.ts')
const propertyService = read('src/app/module/property/property.service.ts')
const userService = read('src/app/module/user/user.service.ts')
const reviewService = read('src/app/module/review/review.service.ts')
const websiteSubmissionService = read('src/app/module/websiteSubmission/websiteSubmission.service.ts')
const viewingService = read('src/app/module/viewing/viewing.service.ts')
const websiteBuilderService = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
const metaService = read('src/app/module/metaIntegration/metaIntegration.service.ts')
const moderationController = read('src/app/module/moderation/moderation.controller.ts')
const bannerController = read('src/app/module/banner/banner.controller.ts')
const sectionController = read('src/app/module/section/section.controller.ts')
const landingController = read('src/app/module/landingPage/landingPage.controller.ts')
const propertyTypeController = read('src/app/module/propertyType/propertyType.controller.ts')
const amenityController = read('src/app/module/amenity/amenity.controller.ts')
const errorHandler = read('src/app/middlewares/globalErrorHandler.ts')

describe('Phase 2 public website lock contract', () => {
  it('exposes one canonical public website assertion with generic unavailable errors', () => {
    expect(tenantAccess).toContain('const assertPublicWebsiteAccess = async')
    expect(tenantAccess).toContain('publicWebsiteAllowed')
    expect(tenantAccess).toContain('API_ERROR_CODES.PUBLIC_WEBSITE_UNAVAILABLE')
    expect(tenantAccess).toContain('API_ERROR_CODES.PUBLIC_WEBSITE_NOT_PUBLISHED')
  })

  it('returns effective public access from both subdomain and verified custom-domain resolvers', () => {
    expect(domainService.match(/publicAccess: TenantAccessService\.toPublicAccess\(access\)/g)?.length).toBeGreaterThanOrEqual(3)
    expect(domainService).toContain('await TenantAccessService.evaluate(direct.organizationId)')
    expect(domainService).toContain('await TenantAccessService.evaluate(org.organizationId)')
  })

  it('guards public reads, public writes, and cached website content', () => {
    for (const source of [
      organizationService,
      propertyService,
      userService,
      reviewService,
      websiteSubmissionService,
      viewingService,
      websiteBuilderService,
      metaService,
      moderationController,
      bannerController,
      sectionController,
      landingController,
      propertyTypeController,
      amenityController,
    ]) {
      expect(source).toContain('TenantAccessService.assertPublicWebsiteAccess')
    }
    expect(organizationService).toMatch(/cached\?\.organizationId[\s\S]*assertPublicWebsiteAccess/)
    expect(websiteBuilderService).toMatch(/WebsiteCache[\s\S]*assertPublicWebsiteAccess/)
  })

  it('marks public lock errors as no-store and non-indexable', () => {
    expect(errorHandler).toContain("X-Robots-Tag")
    expect(errorHandler).toContain('noindex, nofollow, noarchive')
    expect(errorHandler).toContain('no-store, max-age=0, must-revalidate')
  })
})
