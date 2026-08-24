import { describe, expect, it } from 'vitest'
import { calculateBenefitPeriodAllowance, type BenefitPlanSnapshot } from '../../app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service'
import {
  applyFixedLeadCapacityPolicyWrite,
  resolvePlanLeadPolicy,
  toBenefitPlanSnapshot,
} from '../../app/module/subscriptionPlan/planLeadPolicy'

const start = new Date('2026-08-01T00:00:00.000Z')

describe('Phase 3 fixed lead capacity', () => {
  it('keeps monthly and yearly capacity identical for new plan versions', () => {
    const plan: BenefitPlanSnapshot = {
      planId: 'starter',
      version: 7,
      leadPolicyVersion: 2,
      baseLeadCapacity: 200,
    }

    const previous = {
      planId: 'starter',
      billingCycle: 'monthly' as const,
      periodEnd: start,
      renewalStreak: 12,
      renewalBonusEnabled: true,
    }
    const monthly = calculateBenefitPeriodAllowance(plan, 'monthly', start, previous)
    const yearly = calculateBenefitPeriodAllowance(plan, 'yearly', start, previous)

    expect(monthly).toMatchObject({
      leadAllowanceModel: 'active_capacity',
      renewalStreak: 1,
      baseLeadAllowance: 200,
      bonusLeadAllowance: 0,
      totalLeadAllowance: 200,
      renewalBonusEnabled: false,
    })
    expect(yearly).toMatchObject({
      leadAllowanceModel: 'active_capacity',
      renewalStreak: 1,
      baseLeadAllowance: 200,
      bonusLeadAllowance: 0,
      totalLeadAllowance: 200,
      renewalBonusEnabled: false,
    })
  })

  it('preserves grandfathered monthly loyalty growth exactly for historical versions', () => {
    const historical: BenefitPlanSnapshot = {
      planId: 'starter',
      version: 6,
      leadAllowanceModel: 'active_capacity',
      baseMonthlyLeadAllowance: 200,
      renewalLeadBonus: 50,
      renewalBonusEnabled: true,
      maxRenewalLeadBonus: 0,
      continuityGraceDays: 3,
    }
    const previous = {
      planId: 'starter',
      billingCycle: 'monthly' as const,
      periodEnd: start,
      renewalStreak: 3,
      renewalBonusEnabled: true,
    }

    expect(calculateBenefitPeriodAllowance(historical, 'monthly', start, previous)).toMatchObject({
      renewalStreak: 4,
      baseLeadAllowance: 200,
      bonusLeadAllowance: 150,
      totalLeadAllowance: 350,
      renewalBonusEnabled: true,
    })
  })

  it('does not persist deprecated renewal configuration on fixed-policy writes', () => {
    const written = applyFixedLeadCapacityPolicyWrite({
      planId: 'starter',
      version: 7,
      baseLeadCapacity: 200,
      leadAllowanceModel: 'active_capacity',
      baseMonthlyLeadAllowance: 200,
      renewalLeadBonus: 50,
      renewalBonusEnabled: true,
      maxRenewalLeadBonus: 500,
      continuityGraceDays: 3,
    }) as Record<string, unknown>

    expect(written.leadPolicyVersion).toBe(2)
    expect(written.baseLeadCapacity).toBe(200)
    expect(written).not.toHaveProperty('leadAllowanceModel')
    expect(written).not.toHaveProperty('baseMonthlyLeadAllowance')
    expect(written).not.toHaveProperty('renewalLeadBonus')
    expect(written).not.toHaveProperty('renewalBonusEnabled')
    expect(written).not.toHaveProperty('maxRenewalLeadBonus')
    expect(written).not.toHaveProperty('continuityGraceDays')
  })

  it('provides zero-growth compatibility values to legacy runtime readers without writing them to snapshots', () => {
    const resolved = resolvePlanLeadPolicy({ planId: 'professional', version: 5, leadPolicyVersion: 2, baseLeadCapacity: 800 })
    expect(resolved).toMatchObject({
      baseLeadCapacity: 800,
      leadAllowanceModel: 'active_capacity',
      baseMonthlyLeadAllowance: 800,
      renewalLeadBonus: 0,
      renewalBonusEnabled: false,
      maxRenewalLeadBonus: 0,
      continuityGraceDays: 0,
    })
    expect(toBenefitPlanSnapshot(resolved)).toEqual({
      planId: 'professional',
      version: 5,
      leadPolicyVersion: 2,
      baseLeadCapacity: 800,
    })
  })
})
