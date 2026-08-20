import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

const pagination = read('src/app/helpers/paginationHelper.ts')
const property = read('src/app/module/property/property.service.ts')
const crmReadModel = read('src/app/module/crm/crmListReadModel.service.ts')
const contact = read('src/app/module/contact/contact.service.ts')
const task = read('src/app/module/task/task.service.ts')
const viewing = read('src/app/module/viewing/viewing.service.ts')
const user = read('src/app/module/user/user.service.ts')
const submissions = read('src/app/module/websiteSubmission/websiteSubmission.service.ts')
const review = read('src/app/module/review/review.service.ts')
const finance = read('src/app/module/finance/finance.service.ts')
const payments = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
const platform = read('src/app/module/platformAdmin/platformAdmin.service.ts')
const bkash = read('src/app/module/bkashPayment/bkashPayment.service.ts')
const migration = read('src/app/db/migratePhase5DashboardOrdering.ts')

describe('Phase 5 dashboard ordering contracts', () => {
  it('owns stable list and calendar sort builders in the shared pagination helper', () => {
    expect(pagination).toContain("return { [sortBy]: direction, _id: direction }")
    expect(pagination).toContain('buildAllowedStableSort')
    expect(pagination).toContain("fallbackSortBy = 'createdAt'")
    expect(pagination).toContain("({ date: 1, startTime: 1, _id: 1 })")
  })

  it('keeps properties, leads and contacts on their canonical stable defaults', () => {
    expect(property).toMatch(/sortBy: sortBy && PROPERTY_SORT_FIELDS[\s\S]*: 'createdAt'/)
    expect(property).toMatch(/_id: safeSort\.sortOrder/)
    expect(crmReadModel).toContain("sortSpec(options.sortBy, options.sortOrder, LEAD_SORT_FIELDS, 'createdAt')")
    expect(crmReadModel).toContain("sortSpec(options.sortBy, options.sortOrder, CONTACT_SORT_FIELDS, 'updatedAt')")
    expect(crmReadModel).toContain('return { [field]: order, _id: order }')
    expect(contact).toContain("{ sortBy: 'updatedAt', sortOrder: 'desc' }")
  })

  it('uses createdAt DESC for table lists but chronological order only for calendar mode', () => {
    expect(task).toContain("allowedSort.has(sortBy) ? sortBy : 'createdAt'")
    expect(task).toContain('buildStableSort(safeSortBy, sortOrder)')
    expect(viewing).toContain("viewMode = 'list'")
    expect(viewing).toContain("viewMode === 'calendar'")
    expect(viewing).toContain("{ sortBy: 'createdAt', sortOrder: 'desc' }")
    expect(viewing).toContain('buildCalendarSort()')
    expect(viewing).not.toContain('.sort({date:1,startTime:1')
  })

  it('keeps users, submissions, reviews and billing history stable newest-first', () => {
    expect(user).toContain('USER_LIST_SORT_FIELDS')
    expect(user).toContain("buildAllowedStableSort(sortBy, sortOrder, USER_LIST_SORT_FIELDS, 'createdAt')")
    expect(submissions).toContain("sortBy: paginationOptions.sortBy || 'createdAt'")
    expect(submissions).toContain('buildStableSort(sortBy, sortOrder)')
    expect(review.match(/createdAt: -1, _id: -1/g)?.length || 0).toBeGreaterThanOrEqual(3)
    expect(payments).toContain("sort({ createdAt: -1, _id: -1 })")
  })

  it('standardizes finance tables and super-admin history with stable id tie-breakers', () => {
    expect(finance.match(/buildStableSort\(safeSortBy, sortOrder\)/g)?.length || 0).toBeGreaterThanOrEqual(5)
    expect(finance).not.toContain("? sortBy : 'transactionDate'")
    expect(finance).not.toContain("? sortBy : 'issueDate'")
    expect(finance).not.toContain("? sortBy : 'name'")
    expect(platform).toContain('AuditEvent.find(filter).sort({ createdAt: -1, _id: -1 })')
    expect(bkash).toContain('sort({ createdAt: -1, _id: -1 })')
  })

  it('ships production indexes that match the canonical stable order', () => {
    for (const collection of ['properties', 'leads', 'tasks', 'viewings', 'users', 'websitesubmissions', 'agencyreviews', 'financetransactions', 'financeinvoices', 'financecommissions', 'financevendors', 'subscriptionpayments', 'auditevents', 'organizations']) {
      expect(migration).toContain(`['${collection}'`)
    }
    expect(migration).toContain("{ organizationId: 1, date: 1, startTime: 1, _id: 1 }")
    expect(migration).toContain("{ organizationId: 1, createdAt: -1, _id: -1 }")
    expect(migration).toContain("Use --apply after reviewing this plan")
  })
})
