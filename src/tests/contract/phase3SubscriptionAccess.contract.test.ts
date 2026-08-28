import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('phase 3 subscription access contract', () => {
  it('enforces one global operational subscription guard with recovery routes', () => {
    const auth = read('src/app/middlewares/auth.ts')
    const guard = read('src/app/middlewares/subscriptionAccess.ts')
    const tenantAccess = read('src/app/module/tenantAccess/tenantAccess.service.ts')
    const tenantTypes = read('src/app/module/tenantAccess/tenantAccess.types.ts')

    expect(tenantTypes).toContain("['trialing', 'active', 'cancel_at_period_end']")
    expect(guard).toContain('TenantAccessService.evaluate')
    expect(tenantAccess).toContain('workspaceAllowed')
    for (const route of ['/organization', '/billing', '/subscription', '/website-price', '/support']) {
      expect(guard).toContain(route)
    }
    expect(guard).toContain("'SUBSCRIPTION_INACTIVE'")
    expect(guard).toContain('upgradeRequired: true')
    expect(guard).toContain('effectiveAccess: access')
    expect(auth).toContain('TenantAccessService.evaluateOrganization')
    expect(auth.match(/await enforceSubscriptionAccess\(req\)/g)?.length || 0).toBeGreaterThanOrEqual(3)
  })

  it('separates trial grace from paid renewal grace and uses the contractual period boundary', () => {
    const policy = read('src/app/module/platformSettings/trialPolicy.service.ts')
    const lifecycle = read('src/app/module/subscription/subscriptionLifecycle.service.ts')
    const validation = read('src/app/module/platformSettings/platformSettings.validation.ts')

    for (const key of ['trialGraceDays', 'paidRenewalGraceDays']) {
      expect(policy).toContain(key)
      expect(validation).toContain(key)
    }
    expect(policy).toContain('paidRenewalGraceDays: 0')
    expect(lifecycle).toContain('periodEnd.getTime() + graceDays * DAY_MS')
    expect(lifecycle).toContain("status === 'cancel_at_period_end'")
  })

  it('does not allow cancellation to reopen an inactive subscription', () => {
    const billing = read('src/app/module/billing/billing.service.ts')
    expect(billing).toContain("subscription.status !== 'active'")
    expect(billing).toContain("subscription.status === 'cancel_at_period_end'")
    expect(billing).toContain('The paid billing period has already ended')
  })

  it('keeps locked leads stored but excludes them from list, search, analytics and exports', () => {
    const leads = read('src/app/module/lead/lead.service.ts')
    const readModel = read('src/app/module/crm/crmListReadModel.service.ts')
    const dashboard = read('src/app/module/dashboard/dashboard.service.ts')

    expect(leads).toContain('{isLocked:{$ne:true}}')
    expect(leads).toContain('await LeadEntitlementService.assertLeadAccessible(organizationId,id)')
    expect(leads).toContain('await LeadEntitlementService.ensureCurrentLeadCapacity(organizationId)')
    expect(readModel).toContain('const accessibleLeadMatch')
    expect(readModel).not.toContain('lockedLeadRedactionStages')
    expect(dashboard).toContain('isLocked: { $ne: true }')
  })

  it('does not hydrate private lead fields through related task/viewing/finance reads', () => {
    for (const relative of [
      'src/app/module/task/task.service.ts',
      'src/app/module/viewing/viewing.service.ts',
      'src/app/module/finance/finance.service.ts',
    ]) {
      expect(read(relative)).toContain("match: { isLocked: { $ne: true } }")
    }
  })
})
