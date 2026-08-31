import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')

describe('Phase 2 database performance contract', () => {
  it('removes Finance budget N+1 reads with one batched spend aggregation', () => {
    const source = read('src/app/module/finance/finance.service.ts')
    const block = source.slice(source.indexOf('const enrichBudgets'), source.indexOf('const updateBudget'))
    expect((block.match(/FinanceTransaction\.aggregate\(/g) || []).length).toBe(1)
    expect(block).toContain('$facet: facets')
    expect(block).toContain('budgetQueries: rows.length ? 2 : 1')
  })

  it('protects deep offset pagination and supports an explicit cursor first page', () => {
    const pagination = read('src/app/helpers/paginationHelper.ts')
    const cursor = read('src/app/helpers/cursorPagination.ts')
    expect(pagination).toContain('max_deep_pagination_skip')
    expect(pagination).toContain('Use cursor pagination')
    expect(cursor).toContain("pagination.cursor !== 'start'")
    expect(cursor).toContain('calculated.limit + 1')
    expect(cursor).toContain('buildKeysetRange')
  })

  it('enables keyset pagination on every requested high-volume collection', () => {
    for (const file of [
      'src/app/module/lead/lead.service.ts',
      'src/app/module/property/property.service.ts',
      'src/app/module/websiteSubmission/websiteSubmission.service.ts',
      'src/app/module/activity/activity.service.ts',
      'src/app/module/notification/notification.service.ts',
      'src/app/module/finance/finance.service.ts',
    ]) {
      const source = read(file)
      expect(source).toContain('prepareCursorPagination')
      expect(source).toContain('finalizeCursorPage')
    }
  })

  it('uses normalized identity lookup and bounded prefix free-text search', () => {
    const lead = read('src/app/module/lead/lead.service.ts')
    const contact = read('src/app/module/contact/contact.service.ts')
    const task = read('src/app/module/task/task.service.ts')
    expect(lead).toContain('normalizedEmail')
    expect(lead).toContain('normalizedPhone')
    expect(contact).toContain('normalizedEmail')
    expect(contact).toContain('normalizedPhone')
    expect(lead).toContain('$regex:`^${search}`')
    expect(task).toContain('$regex: `^${search}`')
  })

  it('ships compound indexes and executionStats verification for critical lists', () => {
    const migration = read('src/app/db/migratePhase2PerformanceIndexes.ts')
    const verifier = read('src/app/db/verifyPhase2QueryPlans.ts')
    for (const name of [
      'property_tenant_created_cursor', 'lead_tenant_created_cursor', 'contact_tenant_updated_cursor',
      'viewing_tenant_created_cursor', 'task_tenant_created_cursor', 'website_submission_tenant_deleted_submitted_cursor',
      'activity_tenant_lead_created_cursor', 'tenant_user_dismissed_created', 'finance_transaction_tenant_deleted_created_cursor', 'finance_transaction_tenant_deleted_amount_sort', 'finance_transaction_tenant_deleted_payment_sort',
    ]) expect(migration).toContain(name)
    expect(verifier).toContain("explain('executionStats')")
    expect(verifier).toContain("walked.stages.has('COLLSCAN')")
    expect(verifier).toContain("walked.stages.has('SORT')")
    expect(verifier).toContain('totalDocsExamined')
    expect(verifier).toContain('totalKeysExamined')
  })

  it('emits structured query timings without customer payloads', () => {
    const profiler = read('src/app/helpers/queryPerformance.ts')
    const organization = read('src/app/module/organization/organization.service.ts')
    expect(profiler).toContain("emitProductionEvent('query_performance'")
    for (const field of ['durationMs', 'dbMs', 'redisMs', 'queryCount', 'resultCount']) expect(profiler).toContain(field)
    expect(organization).toContain("emitProductionEvent('public_site_query_performance'")
    for (const field of ['cacheHit', 'cacheMiss', 'mongoMs', 'redisMs', 'renderMs']) expect(organization).toContain(field)
  })
})
