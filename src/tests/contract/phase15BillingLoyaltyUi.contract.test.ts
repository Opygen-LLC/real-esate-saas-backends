import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 15 billing loyalty explanation contract', () => {
  it('sources billing lead allowance from the benefit-period ledger rather than the active pipeline counter', () => {
    const billing = read('src/app/module/billing/billing.service.ts')
    expect(billing).toContain('EntitlementService.getMonthlyLeadAllowanceSnapshot(organizationId)')
    expect(billing).toContain('leadAllowance')
    expect(billing).toContain('baseAllowance')
    expect(billing).toContain('loyaltyBonus')
    expect(billing).toContain('renewalStreak')
    expect(billing).toContain('remaining')
  })

  it('projects the next Starter monthly renewal on the backend using the latest purchasable plan and effective streak', () => {
    const billing = read('src/app/module/billing/billing.service.ts')
    const benefits = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')
    expect(billing).toContain("SubscriptionPlanService.getLatestPurchasablePlan('starter')")
    expect(billing).toContain('calculateBenefitPeriodAllowance')
    expect(billing).toContain('getEffectiveRenewalStreakForPeriod')
    expect(billing).toContain('additionalLeadAllowance')
    expect(billing).toContain('continuityPreserved')
    expect(billing).toContain('getUpcomingBenefitPeriod')
    expect(benefits).toContain('getEffectiveRenewalStreakForPeriod')
  })

  it('keeps active-period billing snapshots separate from expired/legacy states', () => {
    const entitlement = read('src/app/module/entitlement/entitlement.service.ts')
    expect(entitlement).toContain('previousBenefitPeriodId')
    expect(entitlement).toContain('billingCycle: benefit.billingCycle')
    expect(entitlement).toContain('periodInactive: true')
    expect(entitlement).toContain('legacyFallback: true')
  })
})
