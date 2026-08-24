import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

const assignable = read('src/app/module/crm/crmAssignableMember.service.ts')
const leadService = read('src/app/module/lead/lead.service.ts')
const tenant360 = read('src/app/module/platformAdmin/platformAdmin.tenant360.service.ts')
const tenantManagement = read('src/app/module/platformAdmin/platformAdmin.tenantManagement.service.ts')
const tenantPlanManagement = read('src/app/module/platformAdmin/platformAdmin.tenantPlanManagement.service.ts')
const quote = read('src/app/module/subscription/subscriptionQuote.service.ts')
const payment = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
const benefit = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')
const reconciliation = read('src/app/module/entitlement/subscriptionEntitlementReconciliation.service.ts')
const addon = read('src/app/module/leadAddonSubscription/leadAddonSubscription.service.ts')
const addonValidation = read('src/app/module/leadAddonSubscription/leadAddonSubscription.validation.ts')
const overrideService = read('src/app/module/tenantEntitlementOverride/tenantEntitlementOverride.service.ts')
const entitlement = read('src/app/module/entitlement/entitlement.service.ts')
const migration = read('src/app/db/migrateSubscriptionPlatformPhase7.ts')
const platformRoutes = read('src/app/module/platformAdmin/platformAdmin.route.ts')

describe('Phase 7 production release contract', () => {
  it('uses permission-based lead assignees instead of a role allowlist', () => {
    expect(assignable).toContain("lead: ['leads.read', 'leads.write']")
    expect(assignable).toContain("organizationId")
    expect(assignable).toContain("status: 'active'")
    expect(leadService).toContain("permissions.includes('leads.assign')")
    expect(leadService).toContain("CrmAssignableMemberService.assertAssignableMember")
  })

  it('keeps Agency 360 and management actions behind Super Admin routes', () => {
    expect(platformRoutes).toContain("router.get('/tenants/:organizationId'")
    expect(platformRoutes).toContain("authMiddlewares.authSuperAdmin")
    expect(tenant360).toContain('owner')
    expect(tenant360).toContain('team')
    expect(tenantManagement).toContain("status: 'pending_deletion'")
  })

  it('uses retention rather than an immediate organization delete request', () => {
    expect(tenantManagement).toContain('deletionRetentionUntil')
    expect(tenantManagement).toContain("status: 'pending_deletion'")
    expect(tenantManagement).not.toContain('Organization.deleteOne({ organizationId')
  })

  it('uses exact-time proration and preserves the renewal boundary on upgrade', () => {
    expect(quote).toContain('remainingSeconds / periodTotalSeconds')
    expect(quote).toContain('currentPeriodEnd.getTime() - currentPeriodStart.getTime()')
    expect(payment).toContain('midCycleImmediateChange && existingEnd')
    expect(payment).toContain('currentPeriodEnd: end')
  })

  it('does not treat a paid upgrade as a successful monthly renewal bonus', () => {
    expect(benefit).toContain('if (current < previousEnd) return false')
    expect(payment).toContain('createForPaidSubscription')
  })

  it('keeps downgrade reconciliation non-destructive', () => {
    expect(payment).toContain('scheduleDowngradeOnOrganization')
    expect(reconciliation).toContain('reconcileOrganizationEntitlements')
    expect(reconciliation).not.toContain('Lead.deleteMany')
    expect(reconciliation).not.toContain('Lead.deleteOne')
  })

  it('enforces recurring add-on ceiling, proration, renewal and period-end cancellation', () => {
    expect(addon).toContain('maxRecurringLeadAddon')
    expect(addon).toContain('remainingSeconds / totalSeconds')
    expect(addon).toContain("status = 'cancel_at_period_end'")
    expect(addon).toContain('renewForSubscriptionPeriod')
    expect(addonValidation).toContain("reason: z.string().trim().min(10)")
  })

  it('applies tenant-specific overrides after shared plan/add-on capacity and reconciles expiry', () => {
    expect(entitlement.indexOf('activeRecurringLeadAllowance')).toBeLessThan(entitlement.indexOf('activeTenantOverride'))
    expect(overrideService).toContain('reconcileOrganizationEntitlements')
    expect(overrideService).toContain('applyDueExpirations')
    expect(overrideService).not.toContain('.deleteMany(')
  })

  it('requires reasons on all Phase 1-6 Super Admin tenant mutations', () => {
    expect(platformRoutes.match(/reason: z\.string\(\)\.trim\(\)\.min\(10\)/g)?.length || 0).toBeGreaterThanOrEqual(8)
    expect(tenantPlanManagement).toContain("actorRole: 'super-admin'")
  })

  it('keeps payment confirmation idempotent', () => {
    expect(payment).toContain('if (payment.status === decision.status)')
    expect(payment).toContain('idempotent: true')
    expect(payment).toContain('if (!idempotent && decision.status === \'confirmed\'')
  })

  it('makes the Phase 7 migration structural-only', () => {
    expect(migration).toContain('maxRecurringLeadAddon: 0')
    expect(migration).toContain('organizationPlanMutation: false')
    expect(migration).toContain('organizationPlanVersionMutation: false')
    expect(migration).toContain('legacyTopupConversion: false')
    expect(migration).toContain('assignmentDigestUnchanged: true')
    expect(migration).not.toContain("$set: { 'subscription.plan'")
    expect(migration).not.toContain("$set: { 'subscription.planVersion'")
  })
})
