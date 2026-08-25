import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Website submissions inbox security contract', () => {
  it('defines dedicated read/manage permissions and dependency', () => {
    const access = read('src/app/module/user/accessControl.ts')
    expect(access).toMatch(/website\.submissions\.read/)
    expect(access).toMatch(/website\.submissions\.manage/)
    expect(access).toMatch(/'website\.submissions\.manage': \['website\.submissions\.read'\]/)
  })

  it('protects all inbox routes with tenant-authenticated permissions', () => {
    const routes = read('src/app/module/websiteSubmission/websiteSubmission.route.ts')
    expect(routes).toMatch(/requirePermission\('website\.submissions\.read'\)/)
    expect(routes).toMatch(/requirePermission\('website\.submissions\.manage'\)/)
    expect(routes).not.toMatch(/organizationId.*req\.body/)
  })

  it('always scopes reads and status changes by organizationId', () => {
    const service = read('src/app/module/websiteSubmission/websiteSubmission.service.ts')
    expect(service).toMatch(/\{ organizationId \}/)
    expect(service).toMatch(/findOne\(\{ _id: id, organizationId \}\)/)
    expect(service).toMatch(/findOneAndUpdate\([\s\S]*\{ _id: id, organizationId \}/)
  })

  it('keeps property links tenant-bound and treats property context as authoritative', () => {
    const submissionService = read('src/app/module/websiteSubmission/websiteSubmission.service.ts')
    expect(submissionService).toMatch(/Property\.exists\(\{ _id: payload\.propertyInterest, organizationId \}\)/)
    expect(submissionService).toMatch(/match: \{ organizationId \}/)
    expect(submissionService).toMatch(/if \(payload\.propertyInterest\) return 'PROPERTY_ENQUIRY'/)
  })

  it('public lead capture creates only an inbox row, while viewing and review keep their dedicated records', () => {
    const lead = read('src/app/module/lead/lead.controller.ts')
    const viewing = read('src/app/module/viewing/viewing.controller.ts')
    const review = read('src/app/module/review/review.controller.ts')
    expect(lead).toMatch(/WebsiteSubmissionService\.captureLead\(req\.body, \{ ip: req\.ip, requestId: req\.requestId \}\)/)
    expect(lead).not.toMatch(/LeadService\.publicCaptureLead/)
    expect(viewing).toMatch(/ViewingService\.publicRequestViewing[\s\S]*WebsiteSubmissionService\.captureViewing/)
    expect(review).toMatch(/ReviewService\.submit[\s\S]*WebsiteSubmissionService\.captureReview/)
  })

  it('ships explicit production indexes because production autoIndex is disabled', () => {
    const migration = read('src/app/db/migrateWebsiteSubmissions.ts')
    expect(migration).toMatch(/websitesubmissions/)
    expect(migration).toMatch(/organizationId: 1, status: 1, submittedAt: -1/)
    expect(migration).toMatch(/organizationId: 1, submissionType: 1, submittedAt: -1/)
  })


  it('requires both inbox management and lead-write authority for CRM conversion', () => {
    const routes = read('src/app/module/websiteSubmission/websiteSubmission.route.ts')
    const service = read('src/app/module/websiteSubmission/websiteSubmission.service.ts')
    expect(routes).toMatch(/'\/:id\/move-to-crm'[\s\S]*requirePermission\('website\.submissions\.manage'\)[\s\S]*requirePermission\('leads\.write'\)/)
    expect(service).toContain('LeadService.createLeadWithOutcome')
    expect(service).toContain("{ allowanceSource: 'website' }")
    expect(service).toContain("crmTransferStatus: 'PROCESSING'")
    expect(service).toContain("crmTransferStatus: 'COMPLETED'")
    expect(service).toContain("alreadyMoved: true")
  })

  it('includes submission PII in tenant export and retention deletion', () => {
    const compliance = read('src/app/module/compliance/compliance.service.ts')
    expect(compliance).toMatch(/WebsiteSubmission\.find\(\{ organizationId \}\)/)
    expect(compliance).toMatch(/websitesubmissions/)
  })

})
