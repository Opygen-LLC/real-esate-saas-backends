import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
const root = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
describe('Advanced Accounting Phase 7 production contracts', () => {
  it('has migration-required activation and idempotent opening journal', () => {
    const s = read('src/app/module/finance/financeInitialization.service.ts')
    expect(s).toContain('MIGRATION_REQUIRED')
    expect(s).toContain("sourceType: 'OPENING_BALANCE_MIGRATION'")
    expect(s).toContain('accounting-migration:${organizationId}')
    expect(s).toContain('trialBalance.balanced')
  })
  it('enforces controlled close and year-end closing journals', () => {
    const s = read('src/app/module/finance/financeClose.service.ts')
    expect(s).toContain('Period cannot be closed')
    expect(s).toContain('YEAR_END_CLOSE_PNL')
    expect(s).toContain('YEAR_END_TRANSFER_EARNINGS')
    expect(s).toContain('RETAINED_EARNINGS')
  })
  it('supports maker-checker and immutable posted journals', () => {
    const s = read('src/app/module/finance/financeAccounting.service.ts')
    expect(s).toContain('approveJournal')
    expect(s).toContain('makerCheckerRequired')
    expect(s).toContain('different user')
    expect(s).toContain('POSTED')
  })
  it('routes granular permissions and downgrade read-only access', () => {
    const route = read('src/app/module/finance/finance.route.ts')
    const auth = read('src/app/middlewares/auth.ts')
    for (const p of ['finance.journal.approve','finance.journal.post','finance.period.close','finance.period.reopen','finance.reports.export','finance.audit.read']) expect(route).toContain(p)
    expect(auth).toContain('requireAdvancedAccountingReadAccess')
    expect(auth).toContain('advancedAccountingReadOnly')
  })
  it('keeps tenant purge complete for Phase 7 collections', () => {
    const s = read('src/app/module/compliance/tenantDataCollections.ts')
    expect(s).toContain('financeaccountinginitializations')
    expect(s).toContain('financelegacypaymentmethodmappings')
  })
})
