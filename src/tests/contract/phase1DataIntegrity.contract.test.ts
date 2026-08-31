import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')

describe('Phase 1 tenant/data integrity contract', () => {
  it('ships one reusable tenant-reference guard for critical relationships', () => {
    const source = read('src/app/shared/tenantReference.service.ts')
    for (const helper of [
      'assertPropertyBelongsToOrganization',
      'assertPropertiesBelongToOrganization',
      'assertLeadBelongsToOrganization',
      'assertContactBelongsToOrganization',
      'assertAgentBelongsToOrganization',
      'assertViewingBelongsToOrganization',
      'assertFinanceInvoiceBelongsToOrganization',
      'assertFinanceCommissionBelongsToOrganization',
    ]) expect(source).toContain(helper)
    expect(source).toContain('organizationId, ...extraFilter')
  })

  it('scopes Calendar Sync by organization from the queue through every viewing write', () => {
    const queue = read('src/app/module/operationsQueue/operationsQueue.service.ts')
    const calendar = read('src/app/module/crm/calendarSync.service.ts')
    expect(queue).toContain('CalendarSyncService.syncViewing(job.organizationId, job.entityId)')
    expect(calendar).toContain('const scope = { _id: viewingId, organizationId }')
    expect(calendar).toContain('Viewing.findOne(scope)')
    expect(calendar).not.toContain('Viewing.findById(')
    expect(calendar).toContain("match: { organizationId }")
  })

  it('tenant-scopes Lead, Contact, Finance and Review populations and write references', () => {
    const lead = read('src/app/module/lead/lead.service.ts')
    const contact = read('src/app/module/contact/contact.service.ts')
    const finance = read('src/app/module/finance/finance.service.ts')
    const review = read('src/app/module/review/review.service.ts')
    expect(lead).toContain('TenantReferenceService.assertPropertiesBelongToOrganization')
    expect(lead).toContain("path: 'contactId'")
    expect(lead).toContain('match: { organizationId }')
    expect(contact).toContain('TenantReferenceService.assertPropertiesBelongToOrganization')
    expect(contact).toContain("path: 'sourceLeadId'")
    expect(finance).toContain('assertTransactionRelations')
    expect(finance).toContain('TenantReferenceService.assertFinanceVendorBelongsToOrganization')
    expect(finance).toContain('TenantReferenceService.assertLeadBelongsToOrganization')
    expect(review).toContain("Property.findOne({ _id: invitation.propertyId, organizationId })")
  })

  it('uses a non-empty partial unique subdomain index and deterministic allocation', () => {
    const model = read('src/app/module/organization/organization.model.ts')
    const service = read('src/app/module/organization/organization.service.ts')
    const migration = read('src/app/db/migrateOrganizationSubdomainIntegrity.ts')
    expect(model).not.toContain("sub_domain: {\n      type: String,\n      default: ''")
    expect(model).toContain("name: 'organization_subdomain_unique_nonempty'")
    expect(model).toContain("partialFilterExpression: { sub_domain: { $type: 'string', $gt: '' } }")
    expect(service).toContain('resolveInitialSubdomain')
    expect(service).toContain('SubdomainAlias.exists({ alias: candidate })')
    expect(migration).toContain("const CONFIRMATION = 'organization-subdomain-integrity-phase1'")
    expect(migration).toContain('backupDocuments')
    expect(migration).toContain('legacyIndexes')
    expect(migration).toContain('duplicateGroups')
  })

  it('audits orphan tenants and the requested cross-tenant relationship matrix', () => {
    const audit = read('src/app/db/tenantRelationIntegrity.ts')
    for (const relation of [
      "collection: 'leads', field: 'propertyInterest'",
      "collection: 'leads', field: 'contactId'",
      "collection: 'viewings', field: 'propertyId'",
      "collection: 'viewings', field: 'leadId'",
      "collection: 'viewings', field: 'agentId'",
      "collection: 'tasks', field: 'linkedProperty'",
      "collection: 'tasks', field: 'linkedLead'",
      "collection: 'agencyreviews', field: 'propertyId'",
      "collection: 'financeinvoices', field: 'leadId'",
      "collection: 'financecommissions', field: 'leadId'",
      "collection: 'websiterevisions', field: 'pageId'",
    ]) expect(audit).toContain(relation)
    expect(audit).toContain('tenant-owned document is missing organizationId')
    expect(audit).toContain("targetCollection: 'organizations'")
  })

  it('keeps public/super-admin identity lookups separate while tenant runtime paths are scoped', () => {
    const notification = read('src/app/module/notification/notification.service.ts')
    const realtime = read('src/app/module/realtime/realtime.server.ts')
    const websiteBuilder = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
    expect(notification).toContain('{ organizationId: input.organizationId, jobId: input.jobId, userId: input.userId }')
    expect(realtime).toContain('User.findOne({ _id: payload._id, organizationId: payload.organizationId })')
    expect(websiteBuilder).toContain('_id: candidate._id,\n        organizationId: candidate.organizationId')
  })
})
