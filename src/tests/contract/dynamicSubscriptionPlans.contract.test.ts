import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('dynamic subscription plan contract', () => {
  it('uses validated data-driven plan slugs instead of a fixed plan enum', () => {
    const identity = read('src/app/module/subscriptionPlan/planIdentity.ts')
    const model = read('src/app/module/subscriptionPlan/subscriptionPlan.model.ts')
    const validation = read('src/app/module/subscriptionPlan/subscriptionPlan.validation.ts')
    expect(identity).toContain('PAID_PLAN_ID_PATTERN')
    expect(model).not.toContain("enum: ['starter', 'professional', 'agency', 'enterprise']")
    expect(validation).toContain('paidPlanIdSchema')
    expect(validation).toContain("value !== 'trial'")
  })

  it('persists ordering and classifies upgrades/downgrades from immutable plan-version ranks', () => {
    const model = read('src/app/module/subscriptionPlan/subscriptionPlan.model.ts')
    const schedule = read('src/app/module/subscription/subscriptionSchedule.service.ts')
    expect(model).toContain('displayOrder')
    expect(model).toContain('upgradeRank')
    expect(model).toContain('current_active_upgrade_rank_unique')
    expect(schedule).toContain('currentPlanVersion')
    expect(schedule).toContain('requestedPlanVersion')
    expect(schedule).toContain('requestedRank < currentRank')
  })

  it('ships an idempotent rank/order backfill without changing tenant plan versions', () => {
    const migration = read('src/app/db/migrateDynamicSubscriptionPlans.ts')
    const pkg = read('package.json')
    expect(migration).toContain('tenantPlanVersionMutation: false')
    expect(migration).toContain("$ifNull")
    expect(migration).toContain('current_active_upgrade_rank_unique')
    expect(pkg).toContain('migrate:dynamic-subscription-plans')
  })

  it('keeps cumulative monthly lead growth configurable with zero meaning unlimited bonus growth', () => {
    const validation = read('src/app/module/subscriptionPlan/subscriptionPlan.validation.ts')
    const benefit = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')
    expect(validation).toContain('baseMonthlyLeadAllowance')
    expect(validation).toContain('renewalLeadBonus')
    expect(validation).toContain('renewalBonusEnabled')
    expect(validation).toContain('maxRenewalLeadBonus')
    expect(validation).toContain('continuityGraceDays')
    expect(benefit).toContain('maxRenewalLeadBonus')
  })
})
