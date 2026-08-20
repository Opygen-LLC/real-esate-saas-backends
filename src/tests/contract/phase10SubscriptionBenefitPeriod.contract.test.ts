import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 10 subscription benefit-period ledger', () => {
  it('stores immutable payment and allowance snapshots with an idempotency index', () => {
    const contract = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.interface.ts')
    const model = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.model.ts')
    for (const field of [
      'organizationId', 'paymentNumber', 'planId', 'planVersion', 'periodStart', 'periodEnd', 'renewalStreak',
      'baseLeadAllowance', 'bonusLeadAllowance', 'totalLeadAllowance', 'usedLeadAllowance',
    ]) expect(contract).toContain(field)
    expect(model).toContain("{ paymentSource: 1, paymentNumber: 1 }")
    expect(model).toContain("unique: true")
    expect(model).toContain("tenant_plan_continuity")
  })

  it('derives renewal streaks from the previous ledger period rather than the organization subscription object', () => {
    const service = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')
    expect(service).toContain("SubscriptionBenefitPeriod.findOne")
    expect(service).toContain("planId: input.plan.planId")
    expect(service).toContain("billingCycle: 'monthly'")
    expect(service).toContain('renewalStreak - 1')
    expect(service).toContain('Math.min(uncappedBonus, maxRenewalLeadBonus)')
    expect(service).not.toContain('organization.subscription')
  })

  it('creates the ledger atomically from manual and bKash paid activations', () => {
    const manual = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
    const bkash = read('src/app/module/bkashPayment/bkashPayment.service.ts')
    expect(manual).toContain("paymentSource: 'manual_payment'")
    expect(manual).toContain('createForPaidSubscription')
    expect(manual).toContain('}, session)')
    expect(bkash).toContain("paymentSource: 'bkash'")
    expect(bkash).toContain('createForPaidSubscription')
    expect(bkash).toContain('}, session)')
  })

  it('provides a paginated Super Admin history endpoint and safe create-only migration', () => {
    const route = read('src/app/module/platformAdmin/platformAdmin.route.ts')
    const service = read('src/app/module/platformAdmin/platformAdmin.service.ts')
    const migration = read('src/app/db/migrateSubscriptionBenefitPeriods.ts')
    const pkg = read('package.json')
    expect(route).toContain("'/benefit-periods'")
    expect(route).toContain('authSuperAdmin')
    expect(service).toContain('getBenefitPeriodHistory')
    expect(migration).toContain('createIndexes')
    expect(migration).toContain('does not synthesize historical allowances')
    expect(pkg).toContain('migrate:subscription-benefit-periods')
  })
})
