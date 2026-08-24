import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 9 historical lead entitlement compatibility after Phase 3', () => {
  it('keeps historical renewal fields readable while making baseLeadCapacity canonical', () => {
    const contract = read('src/app/module/subscriptionPlan/subscriptionPlan.interface.ts')
    const model = read('src/app/module/subscriptionPlan/subscriptionPlan.model.ts')
    const policy = read('src/app/module/subscriptionPlan/planLeadPolicy.ts')

    expect(contract).toContain('baseLeadCapacity: number')
    expect(contract).toContain('baseMonthlyLeadAllowance?: number')
    expect(contract).toContain('renewalLeadBonus?: number')
    expect(contract).toContain('renewalBonusEnabled?: boolean')
    expect(contract).toContain('maxRenewalLeadBonus?: number')
    expect(contract).toContain('continuityGraceDays?: number')
    expect(model).toContain('default: undefined')
    expect(policy).toContain('Historical compatibility only')
  })

  it('ships fixed-capacity defaults for fresh environments', () => {
    const service = read('src/app/module/subscriptionPlan/subscriptionPlan.service.ts')
    expect(service).toContain("planId: 'starter'")
    expect(service).toContain('baseLeadCapacity: 200')
    expect(service).toContain('baseLeadCapacity: 800')
    expect(service).toContain('baseLeadCapacity: 2000')
    expect(service).toContain('applyFixedLeadCapacityPolicyWrite')
    expect(service).not.toContain('starterLeadAllowanceDefaults')
  })

  it('forbids renewal-growth fields on new plan writes', () => {
    const validation = read('src/app/module/subscriptionPlan/subscriptionPlan.validation.ts')
    expect(validation).toContain('forbiddenRenewalGrowthFields')
    for (const field of ['baseMonthlyLeadAllowance', 'renewalLeadBonus', 'renewalBonusEnabled', 'maxRenewalLeadBonus', 'continuityGraceDays', 'leadAllowanceModel']) {
      expect(validation).toContain(`${field}: z.never().optional()`)
    }
    expect(validation).toContain('baseLeadCapacity: nonNegativeInteger.optional()')
  })

  it('retains old migration files as historical records instead of rewriting them', () => {
    const migration = read('src/app/db/migrateStarterLeadEntitlement.ts')
    expect(migration).toContain('neutralBackfill')
    expect(migration).toContain("planId: 'starter'")
    expect(migration).toContain('baseMonthlyLeadAllowance: 200')
    expect(migration).toContain('renewalLeadBonus: 50')
  })
})
