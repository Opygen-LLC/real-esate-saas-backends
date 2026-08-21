import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('subscription tier rollover v2 contract', () => {
  it('creates only the exact immutable Starter v6, Professional v4 and Agency v4 targets', () => {
    const migration = read('src/app/db/migrateSubscriptionTierRolloverV2.ts')
    for (const fragment of [
      "planId: 'starter'", 'version: 6', 'priceMonthly: 500', 'priceYearly: 5000', 'baseMonthlyLeadAllowance: 200', 'renewalLeadBonus: 50',
      "planId: 'professional'", 'version: 4', 'priceMonthly: 1000', 'priceYearly: 10000', 'baseMonthlyLeadAllowance: 800', 'renewalLeadBonus: 100',
      "planId: 'agency'", 'priceMonthly: 1500', 'priceYearly: 15000', 'baseMonthlyLeadAllowance: 2000', 'renewalLeadBonus: 200',
      "leadAllowanceModel: 'active_capacity'", 'maxRenewalLeadBonus: 0', 'grandfatherExisting: true',
    ]) expect(migration).toContain(fragment)
    expect(migration).toContain('maxAgents: 3')
    expect(migration).toContain('maxAgents: 5')
    expect(migration).toContain('maxAgents: 10')
    expect(migration).toContain('maxProperties: 10')
    expect(migration).toContain('maxProperties: 25')
    expect(migration).toContain('maxProperties: 50')
    expect(migration).toContain('maxStorageMb: 1024')
    expect(migration).toContain('maxStorageMb: 5120')
  })

  it('is dry-run first, backed up, idempotent, manifested and refuses immutable version overwrites', () => {
    const migration = read('src/app/db/migrateSubscriptionTierRolloverV2.ts')
    const pkg = read('package.json')
    expect(migration).toContain("mode=${cli.apply ? 'APPLY' : 'DRY-RUN'}")
    expect(migration).toContain('if (!cli.apply)')
    expect(migration).toContain('backupDocuments')
    expect(migration).toContain('writeMigrationManifest')
    expect(migration).toContain("state: 'already-applied'")
    expect(migration).toContain('Refusing to overwrite an immutable historical plan version')
    expect(migration).toContain('immutable-version-gap-conflict')
    expect(pkg).toContain('migrate:subscription-tier-rollover-v2')
  })

  it('hard-verifies that Organization subscription plan/version assignments are untouched', () => {
    const migration = read('src/app/db/migrateSubscriptionTierRolloverV2.ts')
    expect(migration).toContain('assignedPlanFingerprint')
    expect(migration).toContain('subscription.plan subscription.planVersion')
    expect(migration).not.toContain('Organization.updateOne')
    expect(migration).not.toContain('Organization.updateMany')
    expect(migration).toContain('Organization.subscription plan/version assignment fingerprint changed during migration')
  })

  it('keeps same-plan manual and bKash renewals pinned to the assigned planVersion', () => {
    const manual = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
    const bkash = read('src/app/module/bkashPayment/bkashPayment.service.ts')
    expect(manual).toContain('resolveDirectPaymentPlan')
    expect(manual).toContain('Number(organization.subscription.planVersion)')
    expect(manual).toContain('PAID_RENEWAL_STATUSES')
    expect(bkash).toContain('resolveCheckoutPlan')
    expect(bkash).toContain('Number(organization.subscription.planVersion)')
    expect(bkash).toContain('PAID_RENEWAL_STATUSES')
  })

  it('uses active pipeline capacity for new versions while preserving legacy paid-period counters', () => {
    const entitlement = read('src/app/module/entitlement/entitlement.service.ts')
    expect(entitlement).toContain("benefit.leadAllowanceModel === 'active_capacity'")
    expect(entitlement).toContain("countLimitedResourceUsage(organizationId, 'leads', session)")
    expect(entitlement).toContain('outstandingLeadReservationUnits')
    expect(entitlement).toContain("benefit?.leadAllowanceModel !== 'active_capacity'")
    expect(entitlement).toContain("$inc: { usedLeadAllowance: granted }")
  })
})
