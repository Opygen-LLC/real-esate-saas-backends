import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const route = read('src/app/module/websiteBuilder/websiteBuilder.route.ts')
const validation = read('src/app/module/websiteBuilder/websiteBuilder.validation.ts')
const service = read('src/app/module/websiteBuilder/websiteDesign.service.ts')
const publication = read('src/app/module/websiteBuilder/websitePublication.service.ts')
const organization = read('src/app/module/organization/organization.service.ts')

describe('Phase 6 production website design API contract', () => {
  it('protects the registry/state/action endpoints with tenant website permission and strict validation', () => {
    expect(route).toContain("router.get('/design-registry', authMiddlewares.requirePermission('website.write')")
    expect(route).toContain("router.get('/design', authMiddlewares.requirePermission('website.write')")
    expect(route).toContain("router.patch('/design', authMiddlewares.requirePermission('website.write'), validateRequest(WebsiteBuilderValidation.designActionSchema)")
    expect(validation).toContain("z.literal('SET_COMPONENT')")
    expect(validation).toContain("z.literal('RESET_ALL_COMPONENTS')")
    expect(validation).toContain("z.literal('SET_ANIMATION')")
    expect(validation).toContain("z.literal('RESET_ALL_ANIMATIONS')")
    expect(validation).toContain("z.literal('SET_ANIMATIONS_ENABLED')")
    expect(validation).toContain("z.literal('APPLY_TEMPLATE')")
    expect(validation).toContain("z.literal('APPLY_DESIGN')")
    expect(validation).toContain('expectedPublicationRevisionSchema')
  })

  it('returns configured and effective state while preserving unavailable premium selections', () => {
    expect(service).toContain('configured: {')
    expect(service).toContain('effective: {')
    expect(service).toContain("reason: 'ENTITLEMENT'")
    expect(service).toContain('componentFallbacks')
    expect(service).toContain('templateFallbackApplied')
    expect(service).toContain('effectiveOverridesForAccess')
    expect(service).toContain('assertDesignDelta')
  })

  it('validates component slot/status/entitlement and animation capabilities server-side', () => {
    expect(service).toContain('ComponentRegistry.assertComponentForSlot')
    expect(service).toContain('TemplateRegistry.assertEntitlement')
    expect(service).toContain('AnimationRegistry.get(animation.preset)')
    expect(service).toContain('supportedDurations.includes')
    expect(service).toContain('supportedDelays.includes')
    expect(service).toContain('supportedTriggers.includes')
    expect(service).toContain('component.supportedAnimations.includes')
  })

  it('publishes once through the existing publication service, invalidates tenant cache and prevents stale writes', () => {
    expect(service).toContain('WebsitePublicationService.commitPublicationState({')
    expect(service).toContain('WebsitePublicationService.afterPublication({')
    expect(service).toContain('action.expectedPublicationRevision !== currentPublicationRevision')
    expect(publication).toContain('expectedPublicationRevision?: number')
    expect(publication).toContain('Website design changed in another session')
    expect(publication).toContain('CacheInvalidationService.invalidateTenant(organizationId)')
  })

  it('records the required immutable audit actions and publishes them as website domain events', () => {
    for (const action of [
      'website.component_changed',
      'website.component_reset',
      'website.components_reset',
      'website.animation_changed',
      'website.animation_reset',
      'website.animations_reset',
      'website.animations_enabled',
      'website.animations_disabled',
      'website.base_template_changed',
    ]) expect(service).toContain(action)
    expect(service).toContain('writeAudit({')
    expect(service).toContain("entityType: 'website_design'")
    expect(service).toContain("eventType: audits.length === 1 ? primaryAudit.action : 'website.design_changed'")
  })

  it('prevents the legacy website-settings endpoint from bypassing design validation and makes public output entitlement-effective', () => {
    expect(organization).toContain('Use controlled /organization/website/design API')
    expect(organization).toContain('WebsiteDesignService.resolveEffectiveDesignForAccess')
    expect(organization).toContain('premiumTemplates: !Boolean(entitlementRestrictions?.premiumTemplates)')
  })
})
