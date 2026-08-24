import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Phase 3 fixed lead capacity release contract', () => {
  it('creates replacement current versions without mutating tenant assignments or historical commercial fields', () => {
    const migration = read('src/app/db/migrateSubscriptionFixedLeadPolicyV3.ts')
    expect(migration).toContain('backupDocuments')
    expect(migration).toContain('writeMigrationManifest')
    expect(migration).toContain('mongoSupportsTransactions')
    expect(migration).toContain('tenantAssignmentMutation: false')
    expect(migration).toContain('historicalCommercialFieldMutation: false')
    expect(migration).toContain("status: 'grandfathered'")
    expect(migration).toContain("status: 'current'")
    expect(migration).not.toContain('organizations.update')
  })

  it('stores only canonical fixed-capacity policy on new plan versions', () => {
    const policy = read('src/app/module/subscriptionPlan/planLeadPolicy.ts')
    const service = read('src/app/module/subscriptionPlan/subscriptionPlan.service.ts')
    expect(policy).toContain('FIXED_LEAD_POLICY_VERSION = 2')
    expect(policy).toContain('stripDeprecatedRenewalGrowthFields')
    expect(service).toContain('applyFixedLeadCapacityPolicyWrite')
    expect(service).toContain('baseLeadCapacity: 200')
    expect(service).toContain('baseLeadCapacity: 800')
    expect(service).toContain('baseLeadCapacity: 2000')
  })

  it('keeps monthly and yearly fixed capacity identical while preserving historical calculation branches', () => {
    const benefit = read('src/app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.service.ts')
    expect(benefit).toContain('const fixedCapacityPolicy = Number(plan.leadPolicyVersion || 0) >= 2')
    expect(benefit).toContain("const leadAllowanceModel: LeadAllowanceModel = fixedCapacityPolicy || plan.leadAllowanceModel === 'active_capacity'")
    expect(benefit).toContain("leadAllowanceModel === 'active_capacity'")
    expect(benefit).toContain("billingCycle === 'yearly' ? baseMonthly * 12 : baseMonthly")
    expect(benefit).toContain('monthlyBonusConfigured = !fixedCapacityPolicy')
  })

  it('rejects deprecated renewal-growth fields from new API writes', () => {
    const validation = read('src/app/module/subscriptionPlan/subscriptionPlan.validation.ts')
    for (const field of ['leadAllowanceModel', 'baseMonthlyLeadAllowance', 'renewalLeadBonus', 'renewalBonusEnabled', 'maxRenewalLeadBonus', 'continuityGraceDays']) {
      expect(validation).toContain(`${field}: z.never().optional()`)
    }
  })

  it('ships a dedicated dry-run/apply migration command', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['migrate:subscription-fixed-lead-policy']).toContain('migrateSubscriptionFixedLeadPolicyV3.ts')
  })
})
