import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const assert = (condition, message) => {
  if (!condition) throw new Error(`[phase1-data-integrity] ${message}`)
}

const organizationService = read('src/app/module/organization/organization.service.ts')
const organizationModel = read('src/app/module/organization/organization.model.ts')
const taskService = read('src/app/module/task/task.service.ts')
const viewingService = read('src/app/module/viewing/viewing.service.ts')
const viewingModel = read('src/app/module/viewing/viewing.model.ts')
const websiteBuilderService = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
const propertyService = read('src/app/module/property/property.service.ts')
const searchHelper = read('src/app/helpers/searchQuery.ts')
const propertyModel = read('src/app/module/property/property.model.ts')
const leadModel = read('src/app/module/lead/lead.model.ts')
const submissionModel = read('src/app/module/websiteSubmission/websiteSubmission.model.ts')
const userModel = read('src/app/module/user/user.model.ts')
const financeModel = read('src/app/module/finance/finance.model.ts')
const domainModel = read('src/app/module/domain/domain.model.ts')

assert(organizationService.includes("target[`socialLinks.${key}`]"), 'social links must use dotted partial updates')
assert(organizationService.includes("unset['socialLinks.twitter']"), 'new X writes must retire the legacy Twitter field')
assert(organizationService.includes('canonicalSocialLinks'), 'organization reads must canonicalize Twitter to X')
assert(organizationService.includes('getPublicSiteInfo(domainOrSubdomain)'), 'legacy public organization lookup must use the explicit public DTO instead of returning the full organization document')
assert(organizationService.includes('const { entitlementRestrictions, updatedAt, ...publicOrg } = org'), 'public website DTO must strip internal entitlement/runtime fields before spreading organization data')
assert(organizationModel.includes('showSocialLinks') && organizationModel.includes('socialVisibility'), 'footer visibility schema is missing')
assert(taskService.includes("Property.exists({ _id: task.linkedProperty, organizationId })"), 'Task.linkedProperty must be tenant validated')
assert(taskService.includes('linkedProperty: prepared.linkedProperty ?? task.linkedProperty'), 'task updates must validate the effective linked property')
assert(websiteBuilderService.includes('WebsitePage.findOne({ _id: preview.pageId, organizationId: preview.organizationId })'), 'preview page reads must be tenant scoped')
assert(viewingService.includes('Viewing.findOne(query)') && viewingService.includes('startTime:{$lt:endTime}') && viewingService.includes('endTime:{$gt:startTime}'), 'viewing conflict query must execute overlap detection in MongoDB')
assert(viewingModel.includes('viewing_tenant_date_status_agent_window') && viewingModel.includes('viewing_tenant_date_status_property_window'), 'viewing conflict indexes are missing')
assert(searchHelper.includes('DEFAULT_SEARCH_TERM_MAX_LENGTH') && searchHelper.includes('escapeRegex'), 'shared bounded regex helper is missing')
assert(propertyService.includes("safeRegexPattern(city, { label: 'City filter' })") && propertyService.includes("safeRegexPattern(state, { label: 'State filter' })"), 'property location regex filters must be escaped')

assert(propertyModel.includes("propertySchema.index({ organizationId: 1, createdAt: -1 })"), 'property tenant chronological index is missing')
assert(leadModel.includes("leadSchema.index({organizationId:1,createdAt:-1}"), 'lead tenant chronological index is missing')
assert(submissionModel.includes("websiteSubmissionSchema.index({ organizationId: 1, status: 1, submittedAt: -1 })"), 'website submission status index is missing')
assert(userModel.includes("user_tenant_created_desc"), 'user tenant chronological index is missing')
assert(financeModel.includes("transactionSchema.index({ organizationId: 1, transactionDate: -1, type: 1, status: 1 })"), 'finance transaction query index is missing')
assert(domainModel.includes("domainRecordSchema.index({ lifecycleStatus: 1, nextCheckAt: 1 })"), 'domain worker lifecycle index is missing')



// Phase 1 tenant integrity hardening.
const tenantReferenceService = read('src/app/shared/tenantReference.service.ts')
const calendarSyncService = read('src/app/module/crm/calendarSync.service.ts')
const operationsQueueService = read('src/app/module/operationsQueue/operationsQueue.service.ts')
const leadService = read('src/app/module/lead/lead.service.ts')
const contactService = read('src/app/module/contact/contact.service.ts')
const financeService = read('src/app/module/finance/finance.service.ts')
const reviewService = read('src/app/module/review/review.service.ts')
const notificationService = read('src/app/module/notification/notification.service.ts')
const tenantRelationIntegrity = read('src/app/db/tenantRelationIntegrity.ts')
const subdomainMigration = read('src/app/db/migrateOrganizationSubdomainIntegrity.ts')

assert(tenantReferenceService.includes('assertPropertiesBelongToOrganization'), 'reusable property tenant-reference validation is missing')
assert(tenantReferenceService.includes('assertFinanceInvoiceBelongsToOrganization'), 'reusable finance tenant-reference validation is missing')
assert(operationsQueueService.includes('CalendarSyncService.syncViewing(job.organizationId, job.entityId)'), 'calendar queue must pass organizationId')
assert(calendarSyncService.includes('const scope = { _id: viewingId, organizationId }'), 'calendar sync must build a tenant scope')
assert(calendarSyncService.includes('Viewing.findOne(scope)'), 'calendar sync root read must be tenant scoped')
assert(!calendarSyncService.includes('Viewing.findById('), 'calendar sync must not use unscoped findById')
assert(leadService.includes('TenantReferenceService.assertPropertiesBelongToOrganization'), 'Lead property relationships must be write-validated')
assert(leadService.includes("path: 'contactId'") && leadService.includes('match: { organizationId }'), 'Lead populated relationships must be tenant scoped')
assert(contactService.includes('TenantReferenceService.assertPropertiesBelongToOrganization'), 'Contact property relationships must be write-validated')
assert(financeService.includes('assertTransactionRelations') && financeService.includes('TenantReferenceService.assertFinanceVendorBelongsToOrganization'), 'Finance relations must be tenant validated')
assert(reviewService.includes("Property.findOne({ _id: invitation.propertyId, organizationId })"), 'Review property relation must be tenant scoped')
assert(notificationService.includes('{ organizationId: input.organizationId, jobId: input.jobId, userId: input.userId }'), 'notification worker idempotency query must be tenant scoped')
assert(organizationModel.includes("name: 'organization_subdomain_unique_nonempty'"), 'organization subdomain partial unique index is missing')
assert(organizationModel.includes("partialFilterExpression: { sub_domain: { $type: 'string', $gt: '' } }"), 'subdomain index must ignore blank legacy values')
assert(organizationService.includes('resolveInitialSubdomain') && organizationService.includes('SubdomainAlias.exists({ alias: candidate })'), 'organization creation must allocate a tenant-safe unique subdomain')
assert(subdomainMigration.includes("const CONFIRMATION = 'organization-subdomain-integrity-phase1'"), 'subdomain migration apply guard is missing')
assert(subdomainMigration.includes('backupDocuments') && subdomainMigration.includes('duplicateGroups'), 'subdomain migration backup/verification is missing')
for (const relationship of [
  "collection: 'leads', field: 'propertyInterest'",
  "collection: 'leads', field: 'contactId'",
  "collection: 'viewings', field: 'propertyId'",
  "collection: 'tasks', field: 'linkedProperty'",
  "collection: 'agencyreviews', field: 'propertyId'",
  "collection: 'financetransactions', field: 'sourceId'",
  "collection: 'websiterevisions', field: 'pageId'",
]) assert(tenantRelationIntegrity.includes(relationship), `tenant reconciliation is missing ${relationship}`)
assert(tenantRelationIntegrity.includes('tenant-owned document is missing organizationId'), 'tenant reconciliation must detect records missing organizationId')

console.log('[phase1-data-integrity] source invariants verified')
