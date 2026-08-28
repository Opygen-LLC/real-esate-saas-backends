import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Tenant access Phase 5 production contract', () => {
  it('keeps the migration structural, fail-closed, non-destructive, and subscription-preserving', () => {
    const migration = read('src/app/db/migrateTenantAccessPhase5.ts')

    expect(migration).toContain("const MIGRATION = 'tenant-access-phase5'")
    expect(migration).toContain('subscriptionFingerprint')
    expect(migration).toContain('subscriptionAssignmentMutation: false')
    expect(migration).toContain('subscriptionStatusMutation: false')
    expect(migration).toContain('subscriptionDateMutation: false')
    expect(migration).toContain('dataDeletion: false')
    expect(migration).toContain("fieldsEligibleForBackfill: ['platformAccess.status', 'websiteStatus']")
    expect(migration).toContain("set.websiteStatus = 'provisioned'")
    expect(migration).not.toMatch(/deleteMany\(|deleteOne\(|dropCollection\(|dropDatabase\(/)
    expect(migration).not.toMatch(/\$set:\s*\{[^}]*subscription\./s)
  })

  it('publishes the required low-cardinality access and lifecycle monitoring metrics', () => {
    const monitoring = read('src/app/module/tenantAccess/tenantAccessMonitoring.service.ts')
    const lifecycle = read('src/app/module/subscription/subscriptionLifecycle.service.ts')
    const worker = read('src/app/module/cron/phase3.worker.ts')

    for (const metric of [
      'tenant_access_locked_total',
      'tenant_access_lock_reason',
      'subscription_reactivation_total',
      'public_site_access_denied_total',
    ]) expect(monitoring).toContain(metric)

    expect(lifecycle).toContain('subscription_expiry_transition_total')
    expect(worker).toContain('subscription_lifecycle_last_success_timestamp')
    expect(worker).toContain('subscription_lifecycle_failures_total')
    expect(monitoring).not.toMatch(/organizationId\s*:/)
  })

  it('keeps platform access, subscription state, and website publication independent', () => {
    const platform = read('src/app/module/platformAdmin/platformAdmin.service.ts')
    const tenantManagement = read('src/app/module/platformAdmin/platformAdmin.tenantManagement.service.ts')
    const users = read('src/app/module/user/user.service.ts')
    const payment = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')

    expect(platform).not.toContain("org.websiteStatus = 'suspended'")
    expect(platform).not.toContain("org.subscription.status = 'suspended'")
    expect(tenantManagement).not.toContain("org.websiteStatus = 'suspended'")
    expect(tenantManagement).not.toContain("org.subscription.status = 'suspended'")
    expect(users).not.toContain("org.websiteStatus = 'suspended'")
    expect(users).not.toContain("org.subscription.status = 'suspended'")

    // Legacy rows may still contain the old coupled values; repair is deliberately
    // conditional and never used by new suspension/archive operations.
    expect(platform).toContain("org.subscription?.status === 'suspended'")
    expect(platform).toContain("org.websiteStatus === 'suspended'")
    expect(tenantManagement).toContain("org.subscription?.status === 'suspended'")
    expect(tenantManagement).toContain("org.websiteStatus === 'suspended'")

    expect(payment).toContain('Billing lifecycle and platform suspension are deliberately independent')
    expect(payment).not.toContain('Reactivate this tenant before confirming a subscription payment')
    expect(payment).toContain("status: 'active'")
  })

  it('keeps expiration as an access lock rather than a destructive tenant lifecycle', () => {
    const lifecycle = read('src/app/module/subscription/subscriptionLifecycle.service.ts')
    const access = read('src/app/module/tenantAccess/tenantAccess.service.ts')
    const transitions = read('src/app/module/tenantAccess/tenantAccessTransition.service.ts')

    for (const source of [lifecycle, access, transitions]) {
      expect(source).not.toMatch(/deleteMany\(|dropCollection\(|dropDatabase\(/)
    }
    expect(lifecycle).toContain("'subscription.status': transition.nextStatus")
    expect(lifecycle).toContain('TenantAccessTransitionService.sync')
    expect(transitions).toContain('deferBackgroundWork')
    expect(transitions).toContain('resumeBackgroundWork')
  })

  it('exposes effective access and renewal state in Super Admin Agency 360', () => {
    const tenant360 = read('src/app/module/platformAdmin/platformAdmin.tenant360.service.ts')
    expect(tenant360).toContain('TenantAccessService.evaluate')
    expect(tenant360).toContain('effectiveAccess')
    expect(tenant360).toContain('renewalRequired')
    expect(tenant360).toContain('websiteConfigurationPreserved')
  })

  it('retains Phase 2/3 direct API, workspace, SEO, and public-write barriers', () => {
    const publicContract = read('src/tests/contract/phase2PublicWebsiteAccess.contract.test.ts')
    const workspaceContract = read('src/tests/contract/phase3SubscriptionAccess.contract.test.ts')
    const websiteBuilder = read('src/app/module/websiteBuilder/websiteBuilder.service.ts')

    expect(publicContract).toContain('TenantAccessService.assertPublicWebsiteAccess')
    expect(workspaceContract).toContain("'SUBSCRIPTION_INACTIVE'")
    expect(websiteBuilder).toContain('TenantAccessService.assertPublicWebsiteAccess')
    expect(websiteBuilder).toContain('getSitemap')
    expect(websiteBuilder).toContain('getRobots')
    expect(websiteBuilder).toContain('propertyShareCard')
  })
})
