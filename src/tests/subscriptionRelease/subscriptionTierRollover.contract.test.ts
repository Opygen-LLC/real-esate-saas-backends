import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('subscription + lead production release contract', () => {
  it('ships one final dry-run-first release migration for the exact immutable target versions', () => {
    const migration = read('src/app/db/migrateSubscriptionLeadReleaseV1.ts')
    for (const fragment of [
      "planId: 'starter', version: 6", 'priceMonthly: 500', 'priceYearly: 5000', 'baseLeadCapacity: 200', 'renewalLeadBonus: 50',
      "planId: 'professional', version: 4", 'priceMonthly: 1000', 'priceYearly: 10000', 'baseLeadCapacity: 800', 'renewalLeadBonus: 100',
      "planId: 'agency', version: 4", 'priceMonthly: 1500', 'priceYearly: 15000', 'baseLeadCapacity: 2000', 'renewalLeadBonus: 200',
      "leadAllowanceModel: 'active_capacity'", 'maxRenewalLeadBonus: 0', 'grandfatherExisting: true',
      "mode: cli.apply ? 'APPLY' : 'DRY-RUN'", 'backupDocuments', 'writeMigrationManifest',
    ]) expect(migration).toContain(fragment)
  })

  it('never reassigns existing tenant planVersion and keeps historical versions active', () => {
    const migration = read('src/app/db/migrateSubscriptionLeadReleaseV1.ts')
    expect(migration).toContain('assignmentFingerprint')
    expect(migration).toContain('tenantPlanVersionMutation: false')
    expect(migration).toContain('historicalVersionsRemainActive: true')
    expect(migration).not.toContain('Organization.updateMany(')
    expect(migration).toContain('Old versions remain isActive=true')
  })

  it('backfills accessibility without deleting Leads and installs the production lock index', () => {
    const migration = read('src/app/db/migrateSubscriptionLeadReleaseV1.ts')
    expect(migration).toContain("{ isLocked: { $exists: false } }")
    expect(migration).toContain("{ $set: { isLocked: false }")
    expect(migration).toContain("lockReason: 'subscription_limit'")
    expect(migration).toContain('leadCountBefore')
    expect(migration).toContain('leadCountAfter')
    expect(migration).toContain('leadDeletion: false')
    expect(migration).toContain('lead_tenant_lock_created')
    expect(migration).not.toContain('deleteMany(')
    expect(migration).not.toContain('deleteOne(')
  })

  it('keeps normal renewals pinned but explicit purchase/change flows can resolve the current catalog version', () => {
    const manual = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
    const bkash = read('src/app/module/bkashPayment/bkashPayment.service.ts')
    for (const source of [manual, bkash]) {
      expect(source).toContain('PAID_RENEWAL_STATUSES')
      expect(source).toContain('Number(organization.subscription.planVersion)')
    }
    expect(manual).toContain('resolveDirectPaymentPlan')
    expect(bkash).toContain('resolveCheckoutPlan')
  })

  it('keeps cache invalidation and realtime subscription events after committed entitlement reconciliation', () => {
    const schedule = read('src/app/module/subscription/subscriptionSchedule.service.ts')
    expect(schedule).toContain('publishSubscriptionEntitlementReconciliation')
    expect(schedule).toContain('CacheInvalidationService.invalidateTenant(organizationId)')
    expect(schedule).toContain("type: 'subscription.changed'")
    expect(schedule.indexOf('CacheInvalidationService.invalidateTenant(organizationId)'))
      .toBeLessThan(schedule.indexOf("type: 'subscription.changed'"))
  })

  it('wires the dedicated release suite and release migration into package commands', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['migrate:subscription-release']).toContain('migrateSubscriptionLeadReleaseV1.ts')
    expect(pkg.scripts['test:subscription-release']).toContain('test:subscription-release:unit')
    expect(pkg.scripts['test:subscription-release:unit']).toContain('subscriptionTierRollover.unit.test.ts')
    expect(pkg.scripts['test:subscription-release:contract']).toContain('subscriptionTierRollover.contract.test.ts')
    expect(pkg.scripts['test:subscription-release:integration']).toContain('subscriptionDowngrade.integration.test.ts')
    expect(pkg.scripts['test:subscription-release:integration']).toContain('leadLocking.integration.test.ts')
    expect(pkg.scripts['test:subscription-release:security']).toContain('leadLocking.security.test.ts')
    expect(pkg.scripts['verify:subscription-release']).toContain('verify-subscription-release.mjs')
    expect(pkg.scripts['verify:release']).toContain('test:subscription-release')
  })
})
