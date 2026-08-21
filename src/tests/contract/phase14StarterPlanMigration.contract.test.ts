import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 14 Starter vNext migration and purchase policy', () => {
  it('ships a new migration without modifying the historical Starter 500 migration', () => {
    const migration = read('src/app/db/migrateStarterPlanVNext.ts')
    const historical = read('src/app/db/migrateStarterPlanTo500.ts')
    const packageJson = read('package.json')

    expect(migration).toContain("const MIGRATION = 'starter-plan-vnext-v1'")
    expect(migration).toContain('priceMonthly: 500')
    expect(migration).toContain('priceYearly: 5000')
    expect(migration).toContain('baseMonthlyLeadAllowance: 200')
    expect(migration).toContain('renewalLeadBonus: 50')
    expect(migration).toContain('grandfatherExisting: true')
    expect(migration).toContain('backupDocuments')
    expect(migration).toContain('writeMigrationManifest')
    expect(migration).toContain('mongoSupportsTransactions')
    expect(packageJson).toContain('migrate:starter-vnext')

    // The old file remains a historical price migration, not a Phase 14 lead-policy migration.
    expect(historical).toContain("createdBy: 'starter-500-migration'")
    expect(historical).not.toContain('starter-plan-vnext-v1')
  })

  it('does not bulk-migrate tenant planVersion assignments', () => {
    const migration = read('src/app/db/migrateStarterPlanVNext.ts')
    const planWorker = read('src/app/module/subscriptionPlan/subscriptionPlan.service.ts')

    expect(migration).not.toContain("from '../module/organization/organization.model'")
    expect(migration).not.toContain('Organization.update')
    expect(migration).toContain('No Organization subscription assignments are modified')
    expect(migration).toContain('grandfatherExisting: true')
    expect(planWorker).toContain('grandfatherExisting: false')
  })

  it('makes new manual Starter requests resolve the current latest version while confirmations keep the snapshotted version', () => {
    const paymentService = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')

    expect(paymentService).toContain('resolveLatestPurchasablePlan(input.planId)')
    expect(paymentService).toContain('requestedPlanVersion: plan.version')
    expect(paymentService).toContain('resolvePlan(request.requestedPlan, request.requestedPlanVersion, session)')
    expect(paymentService).toContain('resolvePlan(payment.planId, payment.planVersion, session)')
  })

  it('keeps same-plan bKash renewals grandfathered while new/different-plan purchases use the current catalog', () => {
    const bkash = read('src/app/module/bkashPayment/bkashPayment.service.ts')
    expect(bkash).toContain('resolveCheckoutPlan')
    expect(bkash).toContain('SubscriptionPlanService.getLatestPurchasablePlan(requestedPlanId)')
    expect(bkash).toContain('Number(organization.subscription.planVersion)')
    expect(bkash).toContain('planVersion: plan.version || 1')
  })
})
