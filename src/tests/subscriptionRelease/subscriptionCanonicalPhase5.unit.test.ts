import { describe, expect, it } from 'vitest'
import { applyCanonicalPlanWrite, PHASE5_FORBIDDEN_NEW_PLAN_FIELDS } from '../../app/module/subscriptionPlan/planCanonicalWrite'
import { CURRENT_PLAN_CATALOG } from '../../app/module/subscriptionPlan/subscriptionPlan.catalog'
import { calculateBenefitPeriodAllowance } from '../../app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service'

const basePlan = {
  planId: 'starter',
  version: 9,
  name: 'Starter',
  tierRank: 10,
  displayOrder: 10,
  upgradeRank: 10,
  priceMonthly: 500,
  priceYearly: 5000,
  currency: 'BDT',
  maxAgents: 3,
  maxProperties: 10,
  baseLeadCapacity: 200,
  maxLeads: 200,
  maxAddonLeadCapacity: 2000,
  maxStorageMb: 1024,
  maxMonthlyVisitors: 10000,
  leadAllowanceModel: 'active_capacity',
  baseMonthlyLeadAllowance: 200,
  renewalLeadBonus: 50,
  renewalBonusEnabled: true,
  maxRenewalLeadBonus: 500,
  continuityGraceDays: 3,
}

describe('Phase 5 canonical subscription model', () => {
  it('persists one plan-level lead-capacity source and strips legacy write fields', () => {
    const written = applyCanonicalPlanWrite(basePlan)
    expect(written.baseLeadCapacity).toBe(200)
    expect(written.entitlements.leads).toEqual({ enabled: true, limit: 200 })
    expect(written.maxAddonLeadCapacity).toBe(2000)
    for (const field of PHASE5_FORBIDDEN_NEW_PLAN_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(written, field)).toBe(false)
    }
  })

  it('uses one authoritative commercial catalog', () => {
    expect(CURRENT_PLAN_CATALOG.starter.baseLeadCapacity).toBe(200)
    expect(CURRENT_PLAN_CATALOG.starter.maxAddonLeadCapacity).toBe(2000)
    expect(CURRENT_PLAN_CATALOG.professional.baseLeadCapacity).toBe(800)
    expect(CURRENT_PLAN_CATALOG.professional.maxAddonLeadCapacity).toBe(5000)
    expect(CURRENT_PLAN_CATALOG.agency.baseLeadCapacity).toBe(2000)
    expect(CURRENT_PLAN_CATALOG.agency.maxAddonLeadCapacity).toBe(20000)
  })

  it('gives simplified monthly and yearly plans the same fixed base capacity', () => {
    const plan = { planId: 'starter', version: 10, leadPolicyVersion: 2, baseLeadCapacity: 200 }
    const start = new Date('2026-08-01T00:00:00.000Z')
    const monthly = calculateBenefitPeriodAllowance(plan, 'monthly', start, null)
    const yearly = calculateBenefitPeriodAllowance(plan, 'yearly', start, null)
    expect(monthly.totalLeadAllowance).toBe(200)
    expect(yearly.totalLeadAllowance).toBe(200)
    expect(monthly.bonusLeadAllowance).toBe(0)
    expect(yearly.bonusLeadAllowance).toBe(0)
  })
})
