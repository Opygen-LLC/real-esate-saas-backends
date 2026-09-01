import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Advanced Accounting Phase 2 contract', () => {
  it('defines tenant-scoped Chart of Accounts, fiscal periods, journals and journal lines', () => {
    const model = read('src/app/module/finance/financeAccounting.model.ts')
    expect(model).toContain("enum: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']")
    expect(model).toContain('finance_account_tenant_code_unique')
    expect(model).toContain('finance_fiscal_period_tenant_year_number_unique')
    expect(model).toContain('finance_journal_tenant_number_unique')
    expect(model).toContain('finance_journal_line_tenant_journal_line_unique')
    expect(model).toContain("partialFilterExpression: { systemKey: { $type: 'string' } }")
  })

  it('initializes the protected default real-estate Chart of Accounts', () => {
    const service = read('src/app/module/finance/financeAccounting.service.ts')
    for (const code of ['1000', '1110', '1120', '1200', '2100', '2200', '2300', '3100', '3300', '4100', '4200', '4300', '4400', '5100', '5200', '5300', '5400', '5500', '5600', '5700']) {
      expect(service).toContain(`code: '${code}'`)
    }
    expect(service).toContain('System accounts cannot be deleted')
    expect(service).toContain('System account structure and posting controls are protected')
  })

  it('enforces double-entry balance, safe minor units and immutable posting', () => {
    const service = read('src/app/module/finance/financeAccounting.service.ts')
    expect(service).toContain('BigInt(debitMinor)')
    expect(service).toContain('BigInt(creditMinor)')
    expect(service).toContain('JOURNAL_NOT_BALANCED')
    expect(service).toContain('Number.isSafeInteger')
    expect(service).toContain("status: 'POSTED'")
    expect(service).toContain('Posted or reversed journals are immutable')
    expect(service).toContain('Only a posted journal can be reversed')
    expect(service).toContain('Reversal of ${original.journalNumber}')
  })

  it('validates posting period, tenant references, currency and duplicate accounting sources', () => {
    const service = read('src/app/module/finance/financeAccounting.service.ts')
    const posting = read('src/app/module/finance/accountingPosting.service.ts')
    const model = read('src/app/module/finance/financeAccounting.model.ts')
    expect(service).toContain('FISCAL_PERIOD_CLOSED')
    expect(service).toContain('FISCAL_PERIOD_SOFT_LOCKED')
    expect(service).toContain('assertPropertyBelongsToOrganization')
    expect(service).toContain('assertAgentBelongsToOrganization')
    expect(service).toContain('assertFinanceVendorBelongsToOrganization')
    expect(service).toContain('assertClientBelongsToOrganization')
    expect(service).toContain('ACCOUNTING_CURRENCY_MISMATCH')
    expect(posting).toContain('ADVANCED_ACCOUNTING')
    expect(posting).toContain("permissions?.includes('finance.write')")
    expect(posting).toContain('idempotencyKey')
    expect(model).toContain('finance_journal_tenant_source_primary_unique')
    expect(model).toContain('finance_journal_tenant_idempotency_unique')
  })

  it('builds the General Ledger directly from journal lines and supports required filters', () => {
    const service = read('src/app/module/finance/financeAccounting.service.ts')
    expect(service).toContain('FinanceJournalLine.find(filter)')
    expect(service).toContain('journalStatus: { $in: POSTED_LINE_STATUSES }')
    for (const filter of ['accountId', 'propertyId', 'agentId', 'vendorId', 'clientId', 'sourceType']) expect(service).toContain(`query.${filter}`)
  })

  it('protects all Phase 2 accounting data in tenant purge and migration contracts', () => {
    const tenantCollections = read('src/app/module/compliance/tenantDataCollections.ts')
    for (const collection of ['financeaccounts', 'financefiscalyears', 'financefiscalperiods', 'financejournalentries', 'financejournallines', 'financeaccountingsequences']) {
      expect(tenantCollections).toContain(`'${collection}'`)
    }
    const migration = read('src/app/db/migrateAdvancedAccountingPhase2.ts')
    expect(migration).toContain('FinanceAccount.syncIndexes()')
    expect(migration).toContain('FinanceJournalLine.syncIndexes()')
  })
})
