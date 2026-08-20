import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 13 Super Admin lead-bonus controls', () => {
  it('keeps lead entitlement commercial changes inside immutable plan version creation', () => {
    const service = read('src/app/module/subscriptionPlan/subscriptionPlan.service.ts')
    const validation = read('src/app/module/subscriptionPlan/subscriptionPlan.validation.ts')
    for (const field of ['baseMonthlyLeadAllowance', 'renewalLeadBonus', 'maxRenewalLeadBonus', 'continuityGraceDays', 'renewalBonusEnabled']) {
      expect(validation).toContain(field)
    }
    expect(service).toContain('createVersionWrites')
    expect(service).toContain('version: nextVersion')
    expect(service).toContain('isCurrent: false')
    expect(service).toContain('isCurrent: true')
  })

  it('exposes current per-tenant streak, allowance, usage and remaining leads', () => {
    const route = read('src/app/module/platformAdmin/platformAdmin.route.ts')
    const service = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')
    expect(route).toContain("'/tenants/:organizationId/lead-entitlement'")
    expect(route).toContain('authSuperAdmin')
    expect(service).toContain('currentRenewalStreak')
    expect(service).toContain('grantedRenewalStreak')
    expect(service).toContain('remainingLeadAllowance')
    expect(service).toContain('usedLeadAllowance')
    expect(service).toContain('totalLeadAllowance')
  })

  it('stores support streak corrections separately and never rewrites historical benefit periods', () => {
    const adjustmentModel = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitAdjustment.model.ts')
    const benefitService = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')
    expect(adjustmentModel).toContain('previousEffectiveRenewalStreak')
    expect(adjustmentModel).toContain('adjustedRenewalStreak')
    expect(adjustmentModel).toContain('Subscription benefit streak adjustments are immutable')
    expect(benefitService).toContain('SubscriptionBenefitStreakAdjustment.create')
    expect(benefitService).toContain("action: 'subscription.renewal_streak_adjusted'")
    expect(benefitService).toContain('currentPeriodAllowanceUnchanged: true')
    expect(benefitService).not.toContain('SubscriptionBenefitPeriod.updateOne')
    expect(benefitService).not.toContain('SubscriptionBenefitPeriod.findOneAndUpdate')
  })

  it('requires a reason and applies the latest support adjustment only to the next eligible continuity calculation', () => {
    const route = read('src/app/module/platformAdmin/platformAdmin.route.ts')
    const service = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')
    expect(route).toContain("'/tenants/:organizationId/renewal-streak'")
    expect(route).toContain('reason: z.string().trim().min(10).max(500)')
    expect(service).toContain('applyLatestSupportStreakAdjustment')
    expect(service).toContain('benefitPeriodId: String(previous._id)')
    expect(service).toContain('effectivePrevious')
    expect(service).toContain('currentPeriodAllowanceUnchanged: true')
  })

  it('serializes support adjustments against tenant commercial writes and ships an index migration', () => {
    const entitlement = read('src/app/module/entitlement/entitlement.service.ts')
    const platform = read('src/app/module/platformAdmin/platformAdmin.service.ts')
    const migration = read('src/app/db/migrateSubscriptionBenefitStreakAdjustments.ts')
    const pkg = read('package.json')
    expect(entitlement).toContain('withSubscriptionBenefitGuard')
    expect(entitlement).toContain('subscriptionBenefitRevision')
    expect(platform).toContain('withSubscriptionBenefitGuard')
    expect(migration).toContain('createIndexes')
    expect(migration).toContain('Existing benefit-period rows are never rewritten')
    expect(pkg).toContain('migrate:subscription-benefit-streak-adjustments')
  })
})
