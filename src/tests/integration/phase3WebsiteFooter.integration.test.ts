import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip
let mongoose: typeof import('mongoose')
let Organization: any
let Property: any
let User: any
let Viewing: any
let WebsitePage: any
let WebsitePreviewToken: any
let OrganizationService: any
let TaskService: any
let ViewingService: any
let WebsiteBuilderService: any
let CacheInvalidationService: any

suite('Phase 3 website footer/data integrity integration', () => {
  const tenantA = 'org_phase3_footer_a'
  const tenantB = 'org_phase3_footer_b'
  let propertyA: any
  let propertyB: any
  let agentA: any

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'false'
    process.env.WORKER_ENABLED = 'false'
    process.env.SMS_DEV_MODE = 'true'
    mongoose = await import('mongoose')
    await mongoose.connect(requiredDb!, { autoIndex: true })
    await mongoose.connection.dropDatabase()
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ Property } = await import('../../app/module/property/property.model'))
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ Viewing } = await import('../../app/module/viewing/viewing.model'))
    ;({ WebsitePage } = await import('../../app/module/websiteBuilder/websitePage.model'))
    ;({ WebsitePreviewToken } = await import('../../app/module/websiteBuilder/websitePreviewToken.model'))
    ;({ OrganizationService } = await import('../../app/module/organization/organization.service'))
    ;({ TaskService } = await import('../../app/module/task/task.service'))
    ;({ ViewingService } = await import('../../app/module/viewing/viewing.service'))
    ;({ WebsiteBuilderService } = await import('../../app/module/websiteBuilder/websiteBuilder.service'))
    ;({ CacheInvalidationService } = await import('../../app/module/domainEvent/cacheInvalidation.service'))

    await Organization.create([
      {
        organizationId: tenantA, agencyName: 'Phase 3 A', email: 'phase3-a@example.com', phone: '+8801911111101', sub_domain: 'phase3-footer-a', websiteStatus: 'published',
        socialLinks: { whatsapp: '+8801711111111', linkedin: 'https://linkedin.com/company/phase3-a', twitter: 'https://twitter.com/phase3legacy' },
        websiteSettings: { footer: { showSocialLinks: true, socialVisibility: { facebook: true, instagram: true, youtube: true, x: true } } },
        subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 3 },
      },
      { organizationId: tenantB, agencyName: 'Phase 3 B', email: 'phase3-b@example.com', phone: '+8801911111102', sub_domain: 'phase3-footer-b', websiteStatus: 'published', subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 3 } },
    ])
    agentA = await User.create({ name: 'Agent A', email: 'phase3-agent@example.com', phoneNumber: '+8801711111199', organizationId: tenantA, userRole: 'agent', status: 'active', isVerified: true })
    propertyA = await Property.create({ organizationId: tenantA, slug: 'phase3-property-a', title: 'A Property', propertyType: 'Apartment', listingType: 'ForSale', status: 'Available', price: 1000000 })
    propertyB = await Property.create({ organizationId: tenantB, slug: 'phase3-property-b', title: 'B Property', propertyType: 'Apartment', listingType: 'ForSale', status: 'Available', price: 2000000 })
  }, 30_000)

  afterAll(async () => {
    vi.restoreAllMocks()
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('merges partial social/footer changes without erasing unrelated social data and invalidates cache', async () => {
    const invalidate = vi.spyOn(CacheInvalidationService, 'invalidateTenant').mockResolvedValue([])
    await OrganizationService.updateWebsiteSettings(tenantA, {
      socialLinks: { facebook: 'https://facebook.com/phase3-a' },
      websiteSettings: { footer: { socialVisibility: { youtube: false } } },
    })
    const stored = await Organization.findOne({ organizationId: tenantA }).lean()
    expect(stored.socialLinks.facebook).toBe('https://facebook.com/phase3-a')
    expect(stored.socialLinks.whatsapp).toBe('+8801711111111')
    expect(stored.socialLinks.linkedin).toBe('https://linkedin.com/company/phase3-a')
    expect(stored.socialLinks.twitter).toBe('https://twitter.com/phase3legacy')
    expect(stored.websiteSettings.footer.socialVisibility.youtube).toBe(false)
    expect(stored.websiteSettings.footer.socialVisibility.facebook).toBe(true)
    expect(invalidate).toHaveBeenCalledWith(tenantA)
  })

  it('returns the canonical public DTO and reads legacy Twitter as X without internal subscription fields', async () => {
    const site = await OrganizationService.getPublicSiteInfo('phase3-footer-a')
    expect(site.socialLinks.x).toBe('https://twitter.com/phase3legacy')
    expect(site.websiteSettings.footer.socialVisibility.youtube).toBe(false)
    expect(site.stats).toEqual(expect.objectContaining({ totalProperties: 1, totalAgents: 1 }))
    expect(site).not.toHaveProperty('subscription')
    expect(site).not.toHaveProperty('invoiceLogo')
    expect(site).not.toHaveProperty('effectiveAccess')
  })

  it('rejects a task linked to another tenant property', async () => {
    await expect(TaskService.createTask(tenantA, { title: 'Bad relation', dueAt: new Date(Date.now() + 86_400_000), linkedProperty: propertyB._id })).rejects.toThrow(/Linked property must belong to this agency/)
  })

  it('does not resolve a preview token to a page from another tenant', async () => {
    const pageB = await WebsitePage.create({ organizationId: tenantB, slug: '/', title: 'Tenant B Home', status: 'draft', draftDocument: { schemaVersion: 1, sections: [] } })
    const rawToken = 'phase3-cross-tenant-preview-token'
    await WebsitePreviewToken.create({ organizationId: tenantA, pageId: pageB._id, tokenHash: createHash('sha256').update(rawToken).digest('hex'), expiresAt: new Date(Date.now() + 60_000) })
    await expect(WebsiteBuilderService.getPreview(rawToken)).rejects.toThrow(/Preview site not found/)
  })

  it('finds only overlapping agent/property viewing conflicts', async () => {
    await Viewing.create({ organizationId: tenantA, propertyId: propertyA._id, agentId: agentA._id, date: '2030-01-15', startTime: '10:00', endTime: '11:00', status: 'Confirmed', clientName: 'Client', clientPhone: '+8801811111199' })
    await expect(ViewingService.checkConflict(tenantA, String(agentA._id), String(propertyA._id), '2030-01-15', '10:30', '11:30')).resolves.toMatchObject({ hasConflict: true })
    await expect(ViewingService.checkConflict(tenantA, String(agentA._id), String(propertyA._id), '2030-01-15', '11:00', '12:00')).resolves.toEqual({ hasConflict: false })
  })
})
