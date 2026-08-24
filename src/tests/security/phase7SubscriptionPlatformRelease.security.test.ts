import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
const assignable = read('src/app/module/crm/crmAssignableMember.service.ts')
const platformRoutes = read('src/app/module/platformAdmin/platformAdmin.route.ts')
const addonModel = read('src/app/module/leadAddonSubscription/leadAddonSubscription.model.ts')
const addonService = read('src/app/module/leadAddonSubscription/leadAddonSubscription.service.ts')
const paymentModel = read('src/app/module/subscriptionPayment/subscriptionPayment.model.ts')
const paymentService = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
const overrideModel = read('src/app/module/tenantEntitlementOverride/tenantEntitlementOverride.model.ts')
const overrideService = read('src/app/module/tenantEntitlementOverride/tenantEntitlementOverride.service.ts')

describe('Phase 7 tenant isolation and commercial safety', () => {
  it('never resolves an assignable CRM member without the tenant organizationId predicate', () => {
    expect(assignable).toMatch(/const query: any = \{\s*organizationId,/)
    expect(assignable).toContain("status: 'active'")
  })

  it('protects Agency 360 and every tenant plan-management route with authSuperAdmin', () => {
    const relevant = platformRoutes.split('\n').filter((line) => line.includes("/tenants/") && /router\.(get|post|patch|delete)/.test(line))
    expect(relevant.length).toBeGreaterThan(10)
    for (const line of relevant) expect(line).toContain('authMiddlewares.authSuperAdmin')
  })

  it('has database protections against duplicate payment/add-on requests', () => {
    expect(paymentModel).toContain('one_pending_payment_per_request')
    expect(paymentModel).toContain('tenant_method_reference')
    expect(addonModel).toContain("partialFilterExpression: { status: 'pending_payment' }")
    expect(overrideModel).toContain('tenant_entitlement_override_one_active')
  })

  it('requires transaction support for recurring add-on activation in production', () => {
    expect(addonService).toContain("if (config.env === 'production')")
    expect(addonService).toContain('requires a MongoDB replica set or mongos in production')
    expect(addonService).toContain('idempotent: true')
  })

  it('keeps payment and override writes tenant-scoped', () => {
    expect(paymentService).toContain('organizationId: input.organizationId')
    expect(overrideService).toContain("TenantEntitlementOverride.findOne({ organizationId")
    expect(overrideService).toContain("{ organizationId, status: 'active' }")
  })
})
