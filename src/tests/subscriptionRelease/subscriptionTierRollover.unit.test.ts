import { describe, expect, it } from 'vitest'
import { calculateBenefitPeriodAllowance, type BenefitPlanSnapshot, type PreviousBenefitPeriodSnapshot } from '../../app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service'

const monthlyPlan = (planId: 'starter' | 'professional' | 'agency', base: number, bonus: number): BenefitPlanSnapshot => ({
  planId,
  version: planId === 'starter' ? 6 : 4,
  leadAllowanceModel: 'active_capacity',
  baseMonthlyLeadAllowance: base,
  renewalLeadBonus: bonus,
  renewalBonusEnabled: true,
  maxRenewalLeadBonus: 0,
  continuityGraceDays: 3,
})

const nextPeriod = (
  plan: BenefitPlanSnapshot,
  renewalNumber: number,
  start = new Date('2026-01-01T00:00:00.000Z'),
) => {
  let currentStart = new Date(start)
  let previous: PreviousBenefitPeriodSnapshot | null = null
  let result = calculateBenefitPeriodAllowance(plan, 'monthly', currentStart, previous)
  for (let index = 0; index < renewalNumber; index += 1) {
    const nextStart = new Date(currentStart.getTime() + 30 * 24 * 60 * 60 * 1000)
    previous = {
      planId: plan.planId,
      billingCycle: 'monthly',
      periodEnd: nextStart,
      renewalStreak: result.renewalStreak,
      renewalBonusEnabled: result.renewalBonusEnabled,
    }
    currentStart = nextStart
    result = calculateBenefitPeriodAllowance(plan, 'monthly', currentStart, previous)
  }
  return result
}

describe('subscription tier rollover release math', () => {
  it('gives Starter 200 initially then 250, 300 and 350 on consecutive renewals', () => {
    const plan = monthlyPlan('starter', 200, 50)
    expect(nextPeriod(plan, 0)).toMatchObject({ renewalStreak: 1, totalLeadAllowance: 200 })
    expect(nextPeriod(plan, 1)).toMatchObject({ renewalStreak: 2, totalLeadAllowance: 250 })
    expect(nextPeriod(plan, 2)).toMatchObject({ renewalStreak: 3, totalLeadAllowance: 300 })
    expect(nextPeriod(plan, 3)).toMatchObject({ renewalStreak: 4, totalLeadAllowance: 350 })
  })

  it('continues beyond the old 500-bonus ceiling when maxRenewalLeadBonus=0', () => {
    const plan = monthlyPlan('starter', 200, 50)
    expect(nextPeriod(plan, 10)).toMatchObject({ renewalStreak: 11, bonusLeadAllowance: 500, totalLeadAllowance: 700 })
    expect(nextPeriod(plan, 11)).toMatchObject({ renewalStreak: 12, bonusLeadAllowance: 550, totalLeadAllowance: 750 })
    expect(nextPeriod(plan, 20)).toMatchObject({ renewalStreak: 21, bonusLeadAllowance: 1000, totalLeadAllowance: 1200 })
  })

  it('grows Professional and Agency from their own plan-driven bases', () => {
    const professional = monthlyPlan('professional', 800, 100)
    expect(nextPeriod(professional, 0).totalLeadAllowance).toBe(800)
    expect(nextPeriod(professional, 1).totalLeadAllowance).toBe(900)
    expect(nextPeriod(professional, 2).totalLeadAllowance).toBe(1000)

    const agency = monthlyPlan('agency', 2000, 200)
    expect(nextPeriod(agency, 0).totalLeadAllowance).toBe(2000)
    expect(nextPeriod(agency, 1).totalLeadAllowance).toBe(2200)
    expect(nextPeriod(agency, 2).totalLeadAllowance).toBe(2400)
  })

  it('does not multiply active capacity by 12 for yearly billing and gives no monthly-renewal bonus', () => {
    const starter = monthlyPlan('starter', 200, 50)
    const result = calculateBenefitPeriodAllowance(starter, 'yearly', new Date('2026-01-01T00:00:00.000Z'), null)
    expect(result).toMatchObject({ renewalStreak: 1, baseLeadAllowance: 200, bonusLeadAllowance: 0, totalLeadAllowance: 200 })
  })

  it('keeps positive historical caps working for old versions', () => {
    const legacy = { ...monthlyPlan('starter', 200, 50), maxRenewalLeadBonus: 500 }
    expect(nextPeriod(legacy, 20)).toMatchObject({ bonusLeadAllowance: 500, totalLeadAllowance: 700 })
  })
})
