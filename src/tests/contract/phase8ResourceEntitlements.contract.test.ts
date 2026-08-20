import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 8 resource downgrade reconciliation', () => {
  it('routes non-seat resource reconciliation through the canonical subscription boundary', () => {
    const orchestrator = read('src/app/module/entitlement/subscriptionEntitlementReconciliation.service.ts')
    const resource = read('src/app/module/entitlement/resourceEntitlementReconciliation.service.ts')
    expect(orchestrator).toContain('reconcileResourceEntitlements')
    expect(orchestrator).toContain('publishResourceEntitlementReconciliation')
    expect(resource).toContain("action: 'subscription.resources_reconciled'")
    expect(resource).not.toContain('Property.delete')
    expect(resource).not.toContain('DomainRecord.delete')
    expect(resource).not.toContain('WhatsAppIntegration.delete')
  })

  it('locks overflow properties without changing their lifecycle status and allows quota-safe swaps', () => {
    const entitlement = read('src/app/module/entitlement/entitlement.service.ts')
    const model = read('src/app/module/property/property.model.ts')
    const service = read('src/app/module/property/property.service.ts')
    const route = read('src/app/module/property/property.route.ts')
    expect(model).toContain('quotaLocked')
    expect(model).toContain("'subscription_limit'")
    expect(model).toContain("'tenant_admin'")
    expect(entitlement).toContain('propertyQuotaRevision: 1')
    expect(entitlement).toContain('withPropertyQuotaGuard')
    expect(entitlement).toContain("'PROPERTY_QUOTA_LIMIT_REACHED'")
    expect(entitlement).toContain("'Sold', 'Rented', 'OffMarket'")
    expect(service).toContain('setQuotaAccess')
    expect(service).toContain("quotaLockedReason = 'tenant_admin'")
    expect(service).toContain("'PROPERTY_QUOTA_LOCKED'")
    expect(route).toContain("'/:id/quota-access'")
  })

  it('never exposes quota-locked listings through public property or viewing paths', () => {
    const property = read('src/app/module/property/property.service.ts')
    const website = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
    const viewing = read('src/app/module/viewing/viewing.service.ts')
    expect(property).toContain('quotaLocked: { $ne: true }')
    expect(website).toContain("status: 'Available', quotaLocked: { $ne: true }")
    expect(viewing).toContain("status:'Available',quotaLocked:{ $ne:true }")
  })

  it('preserves existing leads while continuing to reject new leads beyond the current limit', () => {
    const resource = read('src/app/module/entitlement/resourceEntitlementReconciliation.service.ts')
    const lead = read('src/app/module/lead/lead.service.ts')
    expect(resource).toContain('preserved: true')
    expect(resource).toContain('overCapacityBy')
    expect(resource).not.toContain('Lead.delete')
    expect(lead).toContain("EntitlementService.assertLimit(organizationId,'leads')")
  })

  it('preserves premium template documents and uses a free public fallback when entitlement is lost', () => {
    const website = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')
    const organization = read('src/app/module/organization/organization.service.ts')
    expect(website).toContain('applyPublicTemplateEntitlement')
    expect(website).toContain("id: 'template-1'")
    expect(website).toContain('premium_template_not_in_plan')
    expect(organization).toContain('configuredTemplateId')
  })

  it('suspends custom-domain routing without deleting DNS/TLS configuration', () => {
    const domainModel = read('src/app/module/domain/domain.model.ts')
    const domainService = read('src/app/module/domain/domain.service.ts')
    const resource = read('src/app/module/entitlement/resourceEntitlementReconciliation.service.ts')
    expect(domainModel).toContain('entitlementStatus')
    expect(domainService).toContain("entitlementStatus: { $ne: 'suspended' }")
    expect(resource).toContain("entitlementStatus: 'suspended'")
    expect(resource).toContain('preserved: true')
  })

  it('gates advanced analytics while preserving reporting data', () => {
    const dashboard = read('src/app/module/dashboard/dashboard.controller.ts')
    expect(dashboard.match(/assertFeature\(organizationId, 'advancedAnalytics'\)/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('stops messaging and lead automation execution while preserving configuration', () => {
    const resource = read('src/app/module/entitlement/resourceEntitlementReconciliation.service.ts')
    const whatsapp = read('src/app/module/whatsapp/whatsapp.service.ts')
    const sms = read('src/app/module/sms/sms.service.ts')
    const crm = read('src/app/module/crm/crm.model.ts')
    expect(resource).toContain("type: 'sms_send'")
    expect(resource).toContain("status: 'cancelled'")
    expect(resource).toContain('configurationPreserved: true')
    expect(resource).toContain('rulesPreserved: true')
    expect(whatsapp).toContain("assertFeature(organizationId, 'whatsAppAutomation')")
    expect(sms).toContain("assertFeature(organizationId, 'smsAutomation')")
    expect(crm).toContain('entitlementExecutionBlocked')
  })

  it('does not delete stored files on downgrade and rejects new generic uploads over quota', () => {
    const resource = read('src/app/module/entitlement/resourceEntitlementReconciliation.service.ts')
    const uploadController = read('src/app/module/upload/upload.controller.ts')
    const uploadRoute = read('src/app/module/upload/upload.route.ts')
    expect(resource).toContain('filesPreserved: true')
    expect(uploadController).toContain('EntitlementService.assertStorage')
    expect(uploadController).toContain('storageUsedBytes')
    expect(uploadRoute).toContain('authMiddlewares.auth()')
  })

  it('ships an atomic one-time reconciliation command for tenants that were already downgraded', () => {
    const script = read('src/app/db/reconcilePhase8ResourceEntitlements.ts')
    const packageJson = read('package.json')
    expect(script).toContain('mongoSupportsTransactions')
    expect(script).toContain('backupDocuments')
    expect(script).toContain('propertyQuotaRevision: 1')
    expect(script).toContain('reconcileResourceEntitlements')
    expect(packageJson).toContain('reconcile:phase8-entitlements')
  })
})
