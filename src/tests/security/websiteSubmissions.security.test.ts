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
    const leadService = read('src/app/module/lead/lead.service.ts')
    const submissionService = read('src/app/module/websiteSubmission/websiteSubmission.service.ts')
    expect(leadService).toMatch(/Property\.exists\(\{_id:propertyInterest,organizationId\}\)/)
    expect(submissionService).toMatch(/match: \{ organizationId \}/)
    expect(submissionService).toMatch(/if \(payload\.propertyInterest\) return 'PROPERTY_ENQUIRY'/)
  })

  it('public lead, viewing and review controllers create inbox rows without replacing CRM records', () => {
    const lead = read('src/app/module/lead/lead.controller.ts')
    const viewing = read('src/app/module/viewing/viewing.controller.ts')
    const review = read('src/app/module/review/review.controller.ts')
    expect(lead).toMatch(/LeadService\.publicCaptureLead[\s\S]*WebsiteSubmissionService\.captureLead/)
    expect(viewing).toMatch(/ViewingService\.publicRequestViewing[\s\S]*WebsiteSubmissionService\.captureViewing/)
    expect(review).toMatch(/ReviewService\.submit[\s\S]*WebsiteSubmissionService\.captureReview/)
  })

  it('ships explicit production indexes because production autoIndex is disabled', () => {
    const migration = read('src/app/db/migrateWebsiteSubmissions.ts')
    expect(migration).toMatch(/websitesubmissions/)
    expect(migration).toMatch(/organizationId: 1, status: 1, submittedAt: -1/)
    expect(migration).toMatch(/organizationId: 1, submissionType: 1, submittedAt: -1/)
  })


  it('includes submission PII in tenant export and retention deletion', () => {
    const compliance = read('src/app/module/compliance/compliance.service.ts')
    expect(compliance).toMatch(/WebsiteSubmission\.find\(\{ organizationId \}\)/)
    expect(compliance).toMatch(/websitesubmissions/)
  })

})
