import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 1 central tenant access engine contract', () => {
  it('centralizes effective workspace/public/background access and precedence', () => {
    const types = read('src/app/module/tenantAccess/tenantAccess.types.ts')
    const service = read('src/app/module/tenantAccess/tenantAccess.service.ts')

    for (const field of [
      'workspaceAllowed',
      'publicWebsiteAllowed',
      'publicWritesAllowed',
      'backgroundBusinessWorkAllowed',
      'recoveryAllowed',
      'subscriptionStatus',
      'platformStatus',
      'websiteStatus',
    ]) expect(types).toContain(field)

    for (const reason of [
      'PLATFORM_SUSPENDED',
      'PLATFORM_ARCHIVED',
      'TENANT_PENDING_DELETION',
      'TRIAL_ENDED',
      'TRIAL_EXPIRED',
      'PAYMENT_PAST_DUE',
      'SUBSCRIPTION_GRACE',
      'SUBSCRIPTION_EXPIRED',
      'WEBSITE_NOT_PUBLISHED',
    ]) expect(types).toContain(reason)

    const pending = service.indexOf("input.platformStatus === 'pending_deletion'")
    const archived = service.indexOf("input.platformStatus === 'archived'")
    const suspended = service.indexOf("input.platformStatus === 'suspended'")
    const subscription = service.indexOf('!ACCESSIBLE_SUBSCRIPTION_STATUS_SET.has')
    const website = service.indexOf("input.websiteStatus !== 'published'")
    expect(pending).toBeGreaterThan(-1)
    expect(archived).toBeGreaterThan(pending)
    expect(suspended).toBeGreaterThan(archived)
    expect(subscription).toBeGreaterThan(suspended)
    expect(website).toBeGreaterThan(subscription)
  })

  it('reconciles lifecycle boundaries before request-time access decisions', () => {
    const service = read('src/app/module/tenantAccess/tenantAccess.service.ts')
    const lifecycle = read('src/app/module/subscription/subscriptionLifecycle.service.ts')
    const guard = read('src/app/middlewares/subscriptionAccess.ts')

    expect(service).toContain('reconcileOrganizationSubscriptionBoundaryState')
    expect(guard).toContain('reconcileSubscription: true')
    expect(lifecycle).toContain('Billing lifecycle remains independent from platform suspension')
    expect(lifecycle).toContain('reconcileOrganizationSubscriptionBoundaryState')
  })

  it('runs lifecycle reconciliation through the real worker and avoids a duplicate cron pass', () => {
    const worker = read('src/app/module/cron/phase3.worker.ts')
    const cron = read('src/app/module/cron/cron.route.ts')

    expect(worker).toContain('reconcileSubscriptions()')
    expect(worker).toContain('subscriptionLifecycle.scheduledChanges')
    expect(worker).toContain('subscription_lifecycle_last_success_timestamp_seconds')
    expect(cron).toContain('runPhase3Maintenance()')
    expect(cron).not.toContain("import { reconcileSubscriptions }")
  })

  it('returns canonical effective access from the recovery-safe organization endpoint', () => {
    const organization = read('src/app/module/organization/organization.service.ts')
    const guard = read('src/app/middlewares/subscriptionAccess.ts')

    expect(organization).toContain('TenantAccessService.evaluateOrganization(result)')
    expect(organization).toContain('effectiveAccess,')
    expect(guard).toContain("path === '/organization' && method === 'GET'")
  })
})
