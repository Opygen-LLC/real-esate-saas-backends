import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 4 Super Admin Danger Zone contracts', () => {
  it('enforces the exact organization id plus DELETE PERMANENTLY confirmation server-side', () => {
    const route = read('src/app/module/platformAdmin/platformAdmin.route.ts')
    const management = read('src/app/module/platformAdmin/platformAdmin.tenantManagement.service.ts')

    expect(route).toContain("confirmationText: z.literal('DELETE PERMANENTLY')")
    expect(route).toContain('organizationId: z.string().trim().min(3).max(120)')
    expect(route).toContain('body: z.object({')
    expect(route).toContain('}).strict()')
    expect(management).toContain('confirmedOrganizationId !== routeOrganizationId')
    expect(management).toContain("confirmationText !== 'DELETE PERMANENTLY'")
    expect(management).not.toContain('confirmation !== org.agencyName')
  })

  it('returns the grouped deletion preview required by the Danger Zone UI', () => {
    const purge = read('src/app/module/compliance/tenantPurge.service.ts')
    for (const field of [
      'tasks',
      'viewings',
      'financeRecords',
      'websiteRecords',
      'files',
      'domains',
      'otherRecords',
      'auditEvents',
    ]) {
      expect(purge).toContain(field)
    }
    expect(purge).toContain('FINANCE_PREVIEW_COLLECTIONS')
    expect(purge).toContain('WEBSITE_PREVIEW_COLLECTIONS')
    expect(purge).toContain('Math.max(0, totalTenantDocuments - displayedDatabaseRecords)')
  })

  it('does not return retention/legal-review state in the permanent deletion preview contract', () => {
    const purge = read('src/app/module/compliance/tenantPurge.service.ts')
    const previewStart = purge.indexOf('const previewOrganization')
    const purgeStart = purge.indexOf('const deleteUserLinkedDocuments', previewStart)
    const preview = purge.slice(previewStart, purgeStart)

    expect(preview).not.toContain('retentionDays')
    expect(preview).not.toContain('earliestPermanentDeletionAt')
    expect(preview).not.toContain('legalReviewStatus')
    expect(preview).not.toContain('auditEventsPreserved')
    expect(preview).not.toContain('deletionRequestPreserved')
  })

  it('returns the exact permanent-delete success message', () => {
    const controller = read('src/app/module/platformAdmin/platformAdmin.controller.ts')
    expect(controller).toContain('Organization and all associated data were permanently deleted.')
  })
})
