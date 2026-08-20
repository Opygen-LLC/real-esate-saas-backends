import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 11 continuous subscription policy', () => {
  it('uses the most recent confirmed benefit period across every plan family', () => {
    const service = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')
    expect(service).toContain('findPreviousConfirmedBenefitPeriod')
    expect(service).toContain('SubscriptionBenefitPeriod.findOne({ organizationId })')
    expect(service).toContain(".sort({ createdAt: -1, _id: -1 })")
    expect(service).not.toContain("planId: input.plan.planId,\n      billingCycle: 'monthly'")
  })

  it('requires same Starter plan family, monthly billing, completed prior period, and configured grace', () => {
    const service = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')
    expect(service).toContain("plan.planId !== 'starter'")
    expect(service).toContain("billingCycle !== 'monthly'")
    expect(service).toContain('previous.planId !== plan.planId')
    expect(service).toContain("previous.billingCycle !== 'monthly'")
    expect(service).toContain('current < previousEnd')
    expect(service).toContain('previousEnd + graceDays * DAY_MS')
  })

  it('keeps renewal bonuses Starter-monthly-only even if another plan payload attempts to enable them', () => {
    const benefitService = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')
    const planService = read('src/app/module/subscriptionPlan/subscriptionPlan.service.ts')
    expect(benefitService).toContain("plan.planId === 'starter'")
    expect(benefitService).toContain("billingCycle === 'monthly'")
    expect(planService).toContain("if (plan.planId !== 'starter')")
    expect(planService).toContain('renewalBonusEnabled: false')
  })

  it('calculates continuity only from confirmed paid activation paths', () => {
    const manual = read('src/app/module/subscriptionPayment/subscriptionPayment.service.ts')
    const bkash = read('src/app/module/bkashPayment/bkashPayment.service.ts')
    const entitlement = read('src/app/module/entitlement/subscriptionEntitlementReconciliation.service.ts')
    expect(manual).toContain("payment.status = 'confirmed'")
    expect(manual).toContain('createForPaidSubscription')
    expect(bkash).toContain('createForPaidSubscription')
    expect(entitlement).not.toContain('createForPaidSubscription')
  })

  it('adds an index for confirmation-order continuity lookup without rewriting historical periods', () => {
    const model = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.model.ts')
    const migration = read('src/app/db/migrateContinuousSubscriptionPolicy.ts')
    const pkg = read('package.json')
    expect(model).toContain('tenant_continuity_confirmation_order')
    expect(model).toContain('{ organizationId: 1, createdAt: -1, _id: -1 }')
    expect(migration).toContain('Data rows are not rewritten')
    expect(pkg).toContain('migrate:continuous-subscription')
  })
})
