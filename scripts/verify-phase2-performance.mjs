import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const assert = (condition, message) => {
  if (!condition) throw new Error(`[phase2-performance] ${message}`)
}

const pagination = read('src/app/helpers/paginationHelper.ts')
const cursor = read('src/app/helpers/cursorPagination.ts')
const queryPerformance = read('src/app/helpers/queryPerformance.ts')
const finance = read('src/app/module/finance/finance.service.ts')
const lead = read('src/app/module/lead/lead.service.ts')
const property = read('src/app/module/property/property.service.ts')
const contact = read('src/app/module/contact/contact.service.ts')
const viewing = read('src/app/module/viewing/viewing.service.ts')
const task = read('src/app/module/task/task.service.ts')
const submission = read('src/app/module/websiteSubmission/websiteSubmission.service.ts')
const activity = read('src/app/module/activity/activity.service.ts')
const notification = read('src/app/module/notification/notification.service.ts')
const organization = read('src/app/module/organization/organization.service.ts')
const indexMigration = read('src/app/db/migratePhase2PerformanceIndexes.ts')
const explain = read('src/app/db/verifyPhase2QueryPlans.ts')

assert(pagination.includes('max_deep_pagination_skip'), 'deep skip guard is missing')
assert(pagination.includes('Use cursor pagination'), 'deep pagination response must direct clients to cursor pagination')
assert(cursor.includes("pagination.cursor !== 'start'"), 'cursor=start first-page mode is missing')
assert(cursor.includes('buildKeysetRange') && cursor.includes('encodeKeysetCursor'), 'keyset range/cursor encoding is missing')
assert(cursor.includes('calculated.limit + 1'), 'cursor pages must fetch one sentinel row for hasMore')

const budgetBlock = finance.slice(finance.indexOf('const enrichBudgets'), finance.indexOf('const updateBudget'))
assert((budgetBlock.match(/FinanceTransaction\.aggregate\(/g) || []).length === 1, 'budget enrichment must use exactly one batched transaction aggregation')
assert(budgetBlock.includes('$facet: facets'), 'budget spend aggregation must batch budget windows in one query')
assert(budgetBlock.includes('budgetQueries: rows.length ? 2 : 1'), 'budget list must expose the two-query invariant to profiling')

for (const [name, source] of [
  ['lead', lead], ['property', property], ['contact', contact], ['viewing', viewing], ['task', task],
  ['website-submission', submission], ['activity', activity], ['notification', notification], ['finance', finance],
]) {
  assert(source.includes('createQueryProfile('), `${name} list query profiling is missing`)
}
assert(queryPerformance.includes('durationMs') && queryPerformance.includes('dbMs') && queryPerformance.includes('queryCount') && queryPerformance.includes('resultCount'), 'query profiler is missing required measurements')
assert(organization.includes("'public_site_query_performance'"), 'public website cache/query profiling is missing')
assert(organization.includes('cacheHit') && organization.includes('cacheMiss') && organization.includes('mongoMs') && organization.includes('redisMs') && organization.includes('renderMs'), 'public website profiler fields are incomplete')

for (const source of [lead, contact]) {
  assert(source.includes('normalizedEmail') && source.includes('normalizedPhone'), 'CRM identity search must use normalized email/phone fields')
}
assert(lead.includes('$regex:`^${search}`') || lead.includes('$regex: `^${search}`'), 'Lead free-text search must be prefix bounded')
assert(task.includes('$regex: `^${search}`'), 'Task free-text search must be prefix bounded')

for (const token of [
  'property_tenant_created_cursor', 'lead_tenant_created_cursor', 'contact_tenant_updated_cursor',
  'viewing_tenant_created_cursor', 'task_tenant_created_cursor', 'website_submission_tenant_deleted_submitted_cursor',
  'activity_tenant_lead_created_cursor', 'tenant_user_dismissed_created', 'website_submission_tenant_email_exact', 'website_submission_tenant_phone_exact', 'finance_transaction_tenant_deleted_created_cursor', 'finance_transaction_tenant_deleted_amount_sort', 'finance_transaction_tenant_deleted_payment_sort',
]) assert(indexMigration.includes(token), `index migration is missing ${token}`)

for (const endpointCase of [
  'properties-list', 'leads-list', 'contacts-list', 'viewings-list', 'tasks-list',
  'website-submissions-list', 'finance-transactions-list', 'notifications-list', 'activities-by-lead',
]) assert(explain.includes(endpointCase), `explain verifier is missing ${endpointCase}`)
assert(explain.includes("explain('executionStats')"), 'query verifier must use executionStats')
assert(explain.includes("walked.stages.has('COLLSCAN')"), 'query verifier must fail COLLSCAN')
assert(explain.includes("walked.stages.has('SORT')"), 'query verifier must detect blocking SORT')
assert(explain.includes('totalDocsExamined') && explain.includes('totalKeysExamined') && explain.includes('nReturned'), 'query verifier must report examined/returned metrics')


assert(read('src/app/module/websiteSubmission/websiteSubmission.model.ts').includes('website_submission_tenant_email_exact'), 'website submission exact-email index is missing')
assert(read('src/app/module/websiteSubmission/websiteSubmission.model.ts').includes('website_submission_tenant_phone_exact'), 'website submission exact-phone index is missing')
assert(explain.includes('lead-search-email-exact'), 'lead exact-search explain case is missing')
assert(explain.includes('contact-search-email-exact'), 'contact exact-search explain case is missing')
assert(explain.includes('website-submission-search-email-exact'), 'website submission exact-search explain case is missing')

console.log('[phase2-performance] source invariants verified')
