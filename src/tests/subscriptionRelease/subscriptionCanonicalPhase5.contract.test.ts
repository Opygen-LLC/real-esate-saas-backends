import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 5 production-hardening contract', () => {
  it('rejects legacy subscription-plan write fields', () => {
    const validation = read('src/app/module/subscriptionPlan/subscriptionPlan.validation.ts')
    for (const field of ['maxLeads', 'baseMonthlyLeadAllowance', 'renewalBonusEnabled', 'renewalLeadBonus', 'maxRenewalLeadBonus', 'continuityGraceDays', 'leadAllowanceModel', 'maxRecurringLeadAddon']) {
      expect(validation).toContain(`${field}: z.never().optional()`)
    }
    expect(validation).toContain('leads: z.never().optional()')
  })

  it('uses the catalog for fresh bootstrap instead of duplicated inline defaults', () => {
    const service = read('src/app/module/subscriptionPlan/subscriptionPlan.service.ts')
    expect(service).toContain('CURRENT_PLAN_CATALOG_ROWS')
    expect(service).toContain('catalogEntryToPlanWrite')
    expect(service).not.toContain("planId: 'starter', name: 'Starter'")
  })

  it('migration creates new versions and integrity-checks protected historical collections', () => {
    const migration = read('src/app/db/migrateSubscriptionCanonicalModelV5.ts')
    expect(migration).toContain("status: 'grandfathered'")
    expect(migration).toContain("status: 'current'")
    expect(migration).toContain('tenantAssignmentMutation: false')
    expect(migration).toContain('historicalBenefitPeriodMutation: false')
    expect(migration).toContain('historicalPaymentMutation: false')
    expect(migration).toContain('integrityBefore')
    expect(migration).toContain('integrityAfter')
    expect(migration).not.toMatch(/organizations\.(updateOne|updateMany|replaceOne|deleteOne|deleteMany|insertOne)/)
    expect(migration).not.toMatch(/benefitPeriods\.(updateOne|updateMany|replaceOne|deleteOne|deleteMany|insertOne)/)
    expect(migration).not.toMatch(/payments\.(updateOne|updateMany|replaceOne|deleteOne|deleteMany|insertOne)/)
  })

  it('future benefit rows carry canonical capacity audit fields', () => {
    const model = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.model.ts')
    const service = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')
    for (const field of ['ledgerVersion', 'baseLeadCapacity', 'recurringAddonCapacity', 'effectiveLeadCapacity']) {
      expect(model).toContain(field)
      expect(service).toContain(field)
    }
  })
})
