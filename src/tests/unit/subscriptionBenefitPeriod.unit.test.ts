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

const previousStarter = (periodEnd: Date, renewalStreak: number) => ({
  planId: 'starter' as const,
  billingCycle: 'monthly' as const,
  periodEnd,
  renewalStreak,
  renewalBonusEnabled: true,
})

describe('subscription benefit continuity calculation', () => {
  it('grants 200, 250 and 300 leads across confirmed consecutive Starter monthly periods', () => {
    const firstStart = new Date('2026-08-01T00:00:00.000Z')
    const first = calculateBenefitPeriodAllowance(starter, 'monthly', firstStart, null)
    expect(first).toMatchObject({ renewalStreak: 1, baseLeadAllowance: 200, bonusLeadAllowance: 0, totalLeadAllowance: 200 })

    const secondStart = new Date('2026-09-01T00:00:00.000Z')
    const second = calculateBenefitPeriodAllowance(starter, 'monthly', secondStart, previousStarter(secondStart, first.renewalStreak))
    expect(second).toMatchObject({ renewalStreak: 2, baseLeadAllowance: 200, bonusLeadAllowance: 50, totalLeadAllowance: 250 })

    const thirdStart = new Date('2026-10-01T00:00:00.000Z')
    const third = calculateBenefitPeriodAllowance(starter, 'monthly', thirdStart, previousStarter(thirdStart, second.renewalStreak))
    expect(third).toMatchObject({ renewalStreak: 3, baseLeadAllowance: 200, bonusLeadAllowance: 100, totalLeadAllowance: 300 })
  })

  it('resets after the configured grace period and caps accumulated bonus', () => {
    const reset = calculateBenefitPeriodAllowance(
      starter,
      'monthly',
      new Date('2026-10-05T00:00:00.000Z'),
      previousStarter(new Date('2026-10-01T00:00:00.000Z'), 8),
    )
    expect(reset.renewalStreak).toBe(1)
    expect(reset.bonusLeadAllowance).toBe(0)

    const capped = calculateBenefitPeriodAllowance(
      starter,
      'monthly',
      new Date('2026-11-01T00:00:00.000Z'),
      previousStarter(new Date('2026-11-01T00:00:00.000Z'), 20),
    )
    expect(capped.renewalStreak).toBe(21)
    expect(capped.bonusLeadAllowance).toBe(500)
    expect(capped.totalLeadAllowance).toBe(700)
  })

  it('requires the previous eligible paid period to be completed before continuity can advance', () => {
    const currentStart = new Date('2026-09-01T00:00:00.000Z')
    const result = calculateBenefitPeriodAllowance(
      starter,
      'monthly',
      currentStart,
      previousStarter(new Date('2026-09-02T00:00:00.000Z'), 3),
    )
    expect(result).toMatchObject({ renewalStreak: 1, bonusLeadAllowance: 0, totalLeadAllowance: 200 })
  })

  it('resets Starter continuity after another paid plan family appears in the ledger', () => {
    const result = calculateBenefitPeriodAllowance(starter, 'monthly', new Date('2026-11-01T00:00:00.000Z'), {
      planId: 'professional',
      billingCycle: 'monthly',
      periodEnd: new Date('2026-11-01T00:00:00.000Z'),
      renewalStreak: 1,
      renewalBonusEnabled: false,
    })
    expect(result).toMatchObject({ renewalStreak: 1, bonusLeadAllowance: 0, totalLeadAllowance: 200 })
  })

  it('keeps the loyalty bonus Starter-monthly-only', () => {
    const yearly = calculateBenefitPeriodAllowance(
      starter,
      'yearly',
      new Date('2026-08-01T00:00:00.000Z'),
      previousStarter(new Date('2026-08-01T00:00:00.000Z'), 5),
    )
    expect(yearly).toMatchObject({ renewalStreak: 1, baseLeadAllowance: 2400, bonusLeadAllowance: 0, totalLeadAllowance: 2400, renewalBonusEnabled: false })

    const professional = {
      ...starter,
      planId: 'professional' as const,
      baseMonthlyLeadAllowance: 1000,
    }
    const professionalMonthly = calculateBenefitPeriodAllowance(professional, 'monthly', new Date('2026-09-01T00:00:00.000Z'), {
      planId: 'professional',
      billingCycle: 'monthly',
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
      renewalStreak: 4,
      renewalBonusEnabled: true,
    })
    expect(professionalMonthly).toMatchObject({ renewalStreak: 1, baseLeadAllowance: 1000, bonusLeadAllowance: 0, totalLeadAllowance: 1000, renewalBonusEnabled: false })
  })
})
