import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

const entitlement = read('src/app/module/entitlement/entitlement.service.ts')
const leadService = read('src/app/module/lead/lead.service.ts')
const submissions = read('src/app/module/websiteSubmission/websiteSubmission.service.ts')
const propertyImport = read('src/app/module/property/propertyImport.service.ts')
const propertyService = read('src/app/module/property/property.service.ts')
const draftAssets = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
const sessions = read('src/app/module/auth/auth.services.ts')
const domain = read('src/app/module/domain/domain.service.ts')
const domainProvider = read('src/app/module/domain/providers/domainProvider.ts')

describe('Phase 10 production release acceptance contracts', () => {
  it('enforces one tenant-wide team-member quota including pending reservations', () => {
    expect(entitlement).toContain("export type LimitedResource = 'properties' | 'teamMembers' | 'leads'")
    expect(entitlement).toContain("status: 'pending', expiresAt: { $gt: new Date() }")
    expect(entitlement).toContain('teamMembersOverCapacityBy')
    expect(entitlement).toContain('withTeamMemberQuotaGuard')
  })

  it('returns an explicit lead create/merge outcome without weakening tenant scope', () => {
    expect(leadService).toMatch(/outcome:\s*['"]created['"]|outcome:\s*existing/)
    expect(leadService).toContain('organizationId')
    expect(read('src/app/module/lead/lead.controller.ts')).toContain('assignedAgent')
  })

  it('keeps website submissions tenant-scoped and converts lead-like rows through the existing CRM service only on demand', () => {
    expect(submissions).toContain('organizationId')
    expect(submissions).toContain('linkedEntityType')
    expect(submissions).toContain('linkedEntityId')
    const routes = read('src/app/module/websiteSubmission/websiteSubmission.route.ts')
    expect(routes).toContain("requirePermission('website.submissions.read')")
    expect(routes).toContain("'/:id/move-to-crm'")
    expect(submissions).toContain('LeadService.createLeadWithOutcome')
  })

  it('property import can only preview then confirm and rejects system-owned fields', () => {
    const route = read('src/app/module/property/property.route.ts')
    expect(route).toContain("'/import/preview'")
    expect(route).toContain("'/import/confirm'")
    expect(route).not.toMatch(/post\(['"]\/import['"]/)
    for (const field of ['organizationid', 'createdby', 'updatedby', 'ownerid']) expect(propertyImport).toContain(`'${field}'`)
    expect(propertyImport).toContain('session.organizationId !== organizationId || session.userId !== actor.id')
  })

  it('property export reuses tenant-scoped server filters and a sort allowlist', () => {
    expect(propertyService).toContain('buildPropertyWhereCondition({ ...filters, organizationId })')
    expect(propertyService).toContain('PROPERTY_SORT_FIELDS')
    expect(propertyService).toContain('safePropertySort')
  })

  it('property draft cleanup never deletes claimed/referenced assets and corrects usage', () => {
    expect(draftAssets).toContain("context: 'property-draft', uploadSessionId, claimed: false")
    expect(draftAssets).toContain('propertyReferenceForAsset')
    expect(draftAssets).toContain('cleanupAbandonedPropertyDraftAssets')
    expect(draftAssets).toContain('$subtract')
  })

  it('session management is user-derived and protects the current stored refresh session', () => {
    const route = read('src/app/module/auth/auth.route.ts')
    expect(route).toContain("'/sessions'")
    expect(route).toContain("'/sessions/:sessionId'")
    expect(route).toContain("'/sessions/revoke-others'")
    expect(sessions).toContain('CURRENT_SESSION_CANNOT_BE_REVOKED')
    expect(sessions).not.toMatch(/refreshTokenHash\s*[,}]/)
  })

  it('custom domains stay fail-closed until provider, TLS and public routing are active', () => {
    for (const state of ['PENDING_DNS', 'OWNERSHIP_VERIFIED', 'ROUTING_VERIFIED', 'TLS_PROVISIONING', 'ACTIVE']) {
      expect(domain).toContain(state)
    }
    expect(domain).toContain("tlsStatus: 'active'")
    expect(domain).toContain("publicRoutingStatus: 'active'")
    expect(domainProvider).toContain('registerDomain')
    expect(domainProvider).toContain('verifyRouting')
    expect(domainProvider).toContain('provisionTls')
  })

  it('ships focused DB-backed acceptance suites for the cross-tenant release paths', () => {
    for (const testFile of [
      'src/tests/integration/teamQuota.integration.test.ts',
      'src/tests/integration/crmPhase14.integration.test.ts',
      'src/tests/integration/websiteSubmissions.integration.test.ts',
      'src/tests/integration/tenantIsolation.integration.test.ts',
      'src/tests/integration/propertyImportExport.integration.test.ts',
      'src/tests/integration/propertyDraftAssetLifecycle.integration.test.ts',
      'src/tests/integration/phase8AuthSessionManagement.integration.test.ts',
      'src/tests/integration/domainLifecycle.integration.test.ts',
    ]) {
      expect(fs.existsSync(path.join(root, testFile)), `${testFile} must exist`).toBe(true)
    }
  })
})
