import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 2 website submission to CRM conversion contract', () => {
  const leadController = read('src/app/module/lead/lead.controller.ts')
  const leadService = read('src/app/module/lead/lead.service.ts')
  const service = read('src/app/module/websiteSubmission/websiteSubmission.service.ts')
  const model = read('src/app/module/websiteSubmission/websiteSubmission.model.ts')
  const routes = read('src/app/module/websiteSubmission/websiteSubmission.route.ts')
  const migration = read('src/app/db/migrateWebsiteSubmissions.ts')

  it('public capture stores a pending submission without creating a Lead', () => {
    expect(leadController).toContain('WebsiteSubmissionService.captureLead')
    expect(leadController).not.toContain('LeadService.publicCaptureLead')
    expect(leadService).not.toContain('const publicCaptureLead=async')
    expect(service).toContain("crmTransferStatus: 'PENDING'")
    expect(service).toContain('PrivacyConsentService.recordPublicPrivacyPolicy')
  })

  it('preserves lead inputs that must survive until an admin converts the submission', () => {
    for (const field of ['budgetMin', 'budgetMax', 'propertyType', 'locationPreference']) {
      expect(model).toContain(field)
      expect(service).toContain(field)
    }
    expect(service).toContain('propertyInterest: claim.propertyId ? [String(claim.propertyId)] : []')
    expect(service).toContain("source: 'Website'")
  })

  it('requires both website-submission management and lead-write permissions', () => {
    expect(routes).toMatch(/'\/:id\/move-to-crm'[\s\S]*requirePermission\('website\.submissions\.manage'\)[\s\S]*requirePermission\('leads\.write'\)/)
  })

  it('reuses createLeadWithOutcome instead of duplicating CRM logic', () => {
    expect(service).toContain('LeadService.createLeadWithOutcome')
    expect(service).toContain("{ allowanceSource: 'website' }")
    expect(service).not.toContain('Lead.create(')
  })

  it('is idempotent and concurrency-safe through a claim state machine', () => {
    expect(service).toContain("crmTransferStatus: 'PROCESSING'")
    expect(service).toContain("crmTransferStatus: 'COMPLETED'")
    expect(service).toContain('CRM_TRANSFER_STALE_AFTER_MS')
    expect(service).toContain('CRM_TRANSFER_IN_PROGRESS')
    expect(service).toContain('alreadyMoved: true')
  })

  it('returns capacity failures without deleting or processing the submission', () => {
    expect(service).toContain("const nextStatus = capacityBlocked || accessInactive ? 'PENDING' : 'FAILED'")
    expect(service).toContain('This website submission has been kept safely in your Website Submissions inbox.')
    expect(service).toContain('submissionPreserved: true')
  })

  it('backfills legacy Lead-linked submissions and adds the transfer-status production index', () => {
    expect(migration).toContain("crmTransferStatus: 'COMPLETED'")
    expect(migration).toContain("crmTransferOutcome: 'LEGACY'")
    expect(migration).toContain('organizationId: 1, crmTransferStatus: 1, submittedAt: -1')
  })
})
