import { describe, expect, it } from 'vitest'
import { calculateBenefitPeriodAllowance } from '../../app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service'

const activeCapacityPlan = (
  planId: 'starter' | 'professional' | 'agency',
  baseMonthlyLeadAllowance: number,
  renewalLeadBonus: number,
) => ({
  planId,
  version: planId === 'starter' ? 6 : 4,
  leadAllowanceModel: 'active_capacity' as const,
  baseMonthlyLeadAllowance,
  renewalLeadBonus,
  renewalBonusEnabled: true,
  maxRenewalLeadBonus: 0,
  continuityGraceDays: 3,
})

const previous = (
  planId: 'starter' | 'professional' | 'agency',
  periodEnd: Date,
  renewalStreak: number,
  renewalBonusEnabled = true,
) => ({
  planId,
  billingCycle: 'monthly' as const,
  periodEnd,
  renewalStreak,
  renewalBonusEnabled,
})

describe('subscription benefit continuity calculation', () => {
  it('grows Starter v6 active capacity 200 -> 250 -> 300 -> 350 with an unlimited zero cap', () => {
    const plan = activeCapacityPlan('starter', 200, 50)
    const firstStart = new Date('2026-08-01T00:00:00.000Z')
    const first = calculateBenefitPeriodAllowance(plan, 'monthly', firstStart, null)
    expect(first).toMatchObject({
      renewalStreak: 1,
      baseLeadAllowance: 200,
      bonusLeadAllowance: 0,
      totalLeadAllowance: 200,
      leadAllowanceModel: 'active_capacity',
    })

    const secondStart = new Date('2026-09-01T00:00:00.000Z')
    const second = calculateBenefitPeriodAllowance(plan, 'monthly', secondStart, previous('starter', secondStart, first.renewalStreak))
    expect(second).toMatchObject({ renewalStreak: 2, bonusLeadAllowance: 50, totalLeadAllowance: 250 })

    const thirdStart = new Date('2026-10-01T00:00:00.000Z')
    const third = calculateBenefitPeriodAllowance(plan, 'monthly', thirdStart, previous('starter', thirdStart, second.renewalStreak))
    expect(third).toMatchObject({ renewalStreak: 3, bonusLeadAllowance: 100, totalLeadAllowance: 300 })

    const fourthStart = new Date('2026-11-01T00:00:00.000Z')
    const fourth = calculateBenefitPeriodAllowance(plan, 'monthly', fourthStart, previous('starter', fourthStart, third.renewalStreak))
    expect(fourth).toMatchObject({ renewalStreak: 4, bonusLeadAllowance: 150, totalLeadAllowance: 350 })

    const farFuture = calculateBenefitPeriodAllowance(
      plan,
      'monthly',
      new Date('2028-06-01T00:00:00.000Z'),
      previous('starter', new Date('2028-06-01T00:00:00.000Z'), 20),
    )
    expect(farFuture).toMatchObject({ renewalStreak: 21, bonusLeadAllowance: 1000, totalLeadAllowance: 1200 })
  })

  it('applies the same plan-driven monthly growth to Professional v4 and Agency v4', () => {
    const start = new Date('2026-09-01T00:00:00.000Z')
    const professional = activeCapacityPlan('professional', 800, 100)
    const agency = activeCapacityPlan('agency', 2000, 200)

    expect(calculateBenefitPeriodAllowance(
      professional,
      'monthly',
      start,
      previous('professional', start, 2),
    )).toMatchObject({ renewalStreak: 3, baseLeadAllowance: 800, bonusLeadAllowance: 200, totalLeadAllowance: 1000 })

    expect(calculateBenefitPeriodAllowance(
      agency,
      'monthly',
      start,
      previous('agency', start, 2),
    )).toMatchObject({ renewalStreak: 3, baseLeadAllowance: 2000, bonusLeadAllowance: 400, totalLeadAllowance: 2400 })
  })

  it('starts new active-capacity yearly subscriptions at base capacity without monthly growth', () => {
    const yearly = calculateBenefitPeriodAllowance(
      activeCapacityPlan('starter', 200, 50),
      'yearly',
      new Date('2026-08-01T00:00:00.000Z'),
      previous('starter', new Date('2026-08-01T00:00:00.000Z'), 5),
    )
    expect(yearly).toMatchObject({
      renewalStreak: 1,
      baseLeadAllowance: 200,
      bonusLeadAllowance: 0,
      totalLeadAllowance: 200,
      renewalBonusEnabled: false,
      leadAllowanceModel: 'active_capacity',
    })
  })

  it('preserves grandfathered paid-period yearly multiplication and positive bonus caps', () => {
    const legacy = {
      planId: 'starter' as const,
      version: 5,
      leadAllowanceModel: 'paid_period_credits' as const,
      baseMonthlyLeadAllowance: 200,
      renewalLeadBonus: 50,
      renewalBonusEnabled: true,
      maxRenewalLeadBonus: 500,
      continuityGraceDays: 3,
    }

    const yearly = calculateBenefitPeriodAllowance(legacy, 'yearly', new Date('2026-08-01T00:00:00.000Z'), null)
    expect(yearly).toMatchObject({ baseLeadAllowance: 2400, totalLeadAllowance: 2400, leadAllowanceModel: 'paid_period_credits' })

    const capped = calculateBenefitPeriodAllowance(
      legacy,
      'monthly',
      new Date('2026-11-01T00:00:00.000Z'),
      previous('starter', new Date('2026-11-01T00:00:00.000Z'), 20),
    )
    expect(capped).toMatchObject({ renewalStreak: 21, bonusLeadAllowance: 500, totalLeadAllowance: 700 })
  })

  it('resets continuity after grace expiry, plan-family change, or an ineligible previous period', () => {
    const plan = activeCapacityPlan('starter', 200, 50)
    const graceExpired = calculateBenefitPeriodAllowance(
      plan,
      'monthly',
      new Date('2026-10-05T00:00:00.000Z'),
      previous('starter', new Date('2026-10-01T00:00:00.000Z'), 8),
    )
    expect(graceExpired).toMatchObject({ renewalStreak: 1, bonusLeadAllowance: 0, totalLeadAllowance: 200 })

    const otherFamily = calculateBenefitPeriodAllowance(plan, 'monthly', new Date('2026-11-01T00:00:00.000Z'), {
      planId: 'professional',
      billingCycle: 'monthly',
      periodEnd: new Date('2026-11-01T00:00:00.000Z'),
      renewalStreak: 4,
      renewalBonusEnabled: true,
    })
    expect(otherFamily).toMatchObject({ renewalStreak: 1, bonusLeadAllowance: 0, totalLeadAllowance: 200 })

    const noPriorGrowth = calculateBenefitPeriodAllowance(
      plan,
      'monthly',
      new Date('2026-12-01T00:00:00.000Z'),
      previous('starter', new Date('2026-12-01T00:00:00.000Z'), 7, false),
    )
    expect(noPriorGrowth).toMatchObject({ renewalStreak: 1, bonusLeadAllowance: 0, totalLeadAllowance: 200 })
  })

  it('requires the previous paid period to complete before continuity advances', () => {
    const plan = activeCapacityPlan('starter', 200, 50)
    const currentStart = new Date('2026-09-01T00:00:00.000Z')
    const result = calculateBenefitPeriodAllowance(
      plan,
      'monthly',
      currentStart,
      previous('starter', new Date('2026-09-02T00:00:00.000Z'), 3),
    )
    expect(result).toMatchObject({ renewalStreak: 1, bonusLeadAllowance: 0, totalLeadAllowance: 200 })
  })
})
