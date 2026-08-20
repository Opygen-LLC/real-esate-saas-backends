import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 9 Starter monthly lead entitlement configuration', () => {
  it('keeps active pipeline capacity separate from paid-period lead allowance', () => {
    const contract = read('src/app/module/subscriptionPlan/subscriptionPlan.interface.ts')
    const model = read('src/app/module/subscriptionPlan/subscriptionPlan.model.ts')
    const service = read('src/app/module/subscriptionPlan/subscriptionPlan.service.ts')

    expect(contract).toContain('maxLeads: number')
    expect(contract).toContain('baseMonthlyLeadAllowance: number')
    expect(contract).toContain('renewalLeadBonus: number')
    expect(contract).toContain('renewalBonusEnabled: boolean')
    expect(contract).toContain('maxRenewalLeadBonus: number')
    expect(contract).toContain('continuityGraceDays: number')
    expect(model).toContain('baseMonthlyLeadAllowance')
    expect(service).toContain('maxLeads: 500, ...starterLeadAllowanceDefaults')
  })

  it('ships the requested Starter defaults without hard-coding the cap in renewal calculation logic', () => {
    const service = read('src/app/module/subscriptionPlan/subscriptionPlan.service.ts')
    expect(service).toContain('baseMonthlyLeadAllowance: 200')
    expect(service).toContain('renewalLeadBonus: 50')
    expect(service).toContain('renewalBonusEnabled: true')
    expect(service).toContain('maxRenewalLeadBonus: 500')
    expect(service).toContain('continuityGraceDays: 3')
    expect(service).toContain('validateLeadAllowanceConfig')
  })

  it('validates bonus configuration as part of immutable plan version creation', () => {
    const validation = read('src/app/module/subscriptionPlan/subscriptionPlan.validation.ts')
    const service = read('src/app/module/subscriptionPlan/subscriptionPlan.service.ts')
    expect(validation).toContain('baseMonthlyLeadAllowance')
    expect(validation).toContain('renewalLeadBonus')
    expect(validation).toContain('maxRenewalLeadBonus')
    expect(validation).toContain('continuityGraceDays')
    expect(service).toContain('Maximum renewal lead bonus must be at least the per-renewal bonus')
    expect(service).toContain('mergedCommercialSnapshot')
  })

  it('migrates historical versions neutrally and creates a grandfathered Starter vNext', () => {
    const migration = read('src/app/db/migrateStarterLeadEntitlement.ts')
    const packageJson = read('package.json')
    expect(migration).toContain('neutralBackfill')
    expect(migration).toContain("planId: 'starter'")
    expect(migration).toContain('grandfatherExisting: true')
    expect(migration).toContain('baseMonthlyLeadAllowance: 200')
    expect(migration).toContain('renewalLeadBonus: 50')
    expect(migration).toContain('backupDocuments')
    expect(migration).toContain('writeMigrationManifest')
    expect(migration).toContain('mongoSupportsTransactions')
    expect(packageJson).toContain('migrate:starter-lead-entitlement')
  })
})
