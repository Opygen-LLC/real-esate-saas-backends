import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Advanced Accounting Phase 1 contract', () => {
  it('defines one canonical entitlement and enables Agency Scale by default', () => {
    expect(read('src/app/module/entitlement/entitlement.types.ts')).toContain("ADVANCED_ACCOUNTING: 'advancedAccounting'")
    const catalog = read('src/app/module/subscriptionPlan/subscriptionPlan.catalog.ts')
    expect(catalog).toMatch(/planId: 'agency'[\s\S]*advancedAccounting: true/)
    expect(read('src/app/module/entitlement/featureCatalog.ts')).toContain("['agency', 'enterprise']")
  })
  it('enforces advanced accounting on the backend settings routes', () => {
    const route = read('src/app/module/finance/finance.route.ts')
    expect(route).toContain("requireEntitlement('ADVANCED_ACCOUNTING')")
    expect(route).toContain("/accounting/settings")
  })
  it('supports tenant-specific advanced accounting overrides with expiry and audit history', () => {
    expect(read('src/app/module/tenantEntitlementOverride/tenantEntitlementOverride.interface.ts')).toContain('advancedAccounting?: boolean')
    expect(read('src/app/module/tenantEntitlementOverride/tenantEntitlementOverride.service.ts')).toContain('subscription.tenant_entitlement_override_applied')
    expect(read('src/app/module/platformAdmin/platformAdmin.tenant360.service.ts')).toContain('entitlements: effectiveSnapshot.limits.entitlements')
  })
  it('persists tenant accounting setup safely and registers it for permanent tenant deletion', () => {
    expect(read('src/app/module/finance/financeAccountingSettings.model.ts')).toContain('finance_accounting_settings_tenant_unique')
    expect(read('src/app/module/compliance/tenantDataCollections.ts')).toContain("'financeaccountingsettings'")
    expect(read('src/app/db/migrateAdvancedAccountingPhase1.ts')).toContain('config.database_string')
  })
})
