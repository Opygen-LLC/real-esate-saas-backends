import { describe, expect, it } from 'vitest'
import { calculateBenefitPeriodAllowance } from '../../app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service'

const starter = {
  planId: 'starter' as const,
  version: 10,
  baseMonthlyLeadAllowance: 200,
  renewalLeadBonus: 50,
  renewalBonusEnabled: true,
  maxRenewalLeadBonus: 500,
  continuityGraceDays: 3,
}

describe('subscription benefit allowance calculation', () => {
  it('grants 200, 250 and 300 leads across consecutive monthly periods', () => {
    const firstStart = new Date('2026-08-01T00:00:00.000Z')
    const first = calculateBenefitPeriodAllowance(starter, 'monthly', firstStart, null)
    expect(first).toMatchObject({ renewalStreak: 1, baseLeadAllowance: 200, bonusLeadAllowance: 0, totalLeadAllowance: 200 })

    const secondStart = new Date('2026-09-01T00:00:00.000Z')
    const second = calculateBenefitPeriodAllowance(starter, 'monthly', secondStart, {
      periodEnd: secondStart,
      renewalStreak: first.renewalStreak,
      renewalBonusEnabled: true,
    })
    expect(second).toMatchObject({ renewalStreak: 2, baseLeadAllowance: 200, bonusLeadAllowance: 50, totalLeadAllowance: 250 })

    const thirdStart = new Date('2026-10-01T00:00:00.000Z')
    const third = calculateBenefitPeriodAllowance(starter, 'monthly', thirdStart, {
      periodEnd: thirdStart,
      renewalStreak: second.renewalStreak,
      renewalBonusEnabled: true,
    })
    expect(third).toMatchObject({ renewalStreak: 3, baseLeadAllowance: 200, bonusLeadAllowance: 100, totalLeadAllowance: 300 })
  })

  it('resets the streak outside the configured grace window and caps accumulated bonus', () => {
    const reset = calculateBenefitPeriodAllowance(starter, 'monthly', new Date('2026-10-05T00:00:00.000Z'), {
      periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      renewalStreak: 8,
      renewalBonusEnabled: true,
    })
    expect(reset.renewalStreak).toBe(1)
    expect(reset.bonusLeadAllowance).toBe(0)

    const capped = calculateBenefitPeriodAllowance(starter, 'monthly', new Date('2026-11-01T00:00:00.000Z'), {
      periodEnd: new Date('2026-11-01T00:00:00.000Z'),
      renewalStreak: 20,
      renewalBonusEnabled: true,
    })
    expect(capped.renewalStreak).toBe(21)
    expect(capped.bonusLeadAllowance).toBe(500)
    expect(capped.totalLeadAllowance).toBe(700)
  })

  it('keeps renewal loyalty monthly-only while preserving yearly base allowance', () => {
    const yearly = calculateBenefitPeriodAllowance(starter, 'yearly', new Date('2026-08-01T00:00:00.000Z'), null)
    expect(yearly).toMatchObject({ renewalStreak: 1, baseLeadAllowance: 2400, bonusLeadAllowance: 0, totalLeadAllowance: 2400 })
  })
})
