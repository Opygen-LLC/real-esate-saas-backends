import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 1 Super Admin hard-delete contracts', () => {
  it('exposes one immediate Super Admin hard-delete endpoint and removes scheduled deletion routing', () => {
    const route = read('src/app/module/platformAdmin/platformAdmin.route.ts')
    const controller = read('src/app/module/platformAdmin/platformAdmin.controller.ts')
    expect(route).toContain("/tenants/:organizationId/hard-delete")
    expect(route).toContain('authMiddlewares.authSuperAdmin')
    expect(route).not.toContain("/tenants/:organizationId/delete'")
    expect(controller).toContain('hardDeleteTenant')
    expect(controller).not.toContain('scheduled for permanent deletion after the reviewed retention period')
  })

  it('keeps deletion independent from retention/legal review and uses the canonical purge service', () => {
    const management = read('src/app/module/platformAdmin/platformAdmin.tenantManagement.service.ts')
    expect(management).toContain('TenantPurgeService.purgeOrganization')
    expect(management).not.toContain('retentionDays')
    expect(management).not.toContain('legalReviewStatus')
    expect(management).not.toContain('scheduleTenantDeletion')
  })

  it('removes tenant audit events and data-subject requests as part of zero-data hard delete', () => {
    const registry = read('src/app/module/compliance/tenantDataCollections.ts')
    const purge = read('src/app/module/compliance/tenantPurge.service.ts')
    expect(registry).toContain("'auditevents'")
    expect(registry).toContain("'datasubjectrequests'")
    expect(purge).toContain('verifyPurged')
    expect(purge).toContain('AccountCredential.deleteMany')
    expect(purge).toContain('UserProfile.deleteMany')
    expect(purge).toContain('Organization.deleteOne')
  })

  it('removes the old compliance retention worker as a second tenant-deletion engine', () => {
    const compliance = read('src/app/module/compliance/compliance.service.ts')
    expect(compliance).not.toContain('executeDueDeletionRequests')
    expect(compliance).not.toContain('retention worker')
    expect(compliance).toContain('retention scheduling is no longer supported')
  })
})
