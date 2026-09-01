import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { moneyFromMinorUnits, moneyToMinorUnits } from '../../app/module/finance/finance.money'

const root = process.cwd()
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Finance Phase 2 contract', () => {
  it('locks legacy Finance and Advanced Accounting to BDT', () => {
    const validation = read('src/app/module/finance/financeAccountingSettings.validation.ts')
    const model = read('src/app/module/finance/financeAccountingSettings.model.ts')
    const contract = read('src/app/module/finance/finance.contract.ts')
    expect(validation).toContain("z.literal('BDT')")
    expect(model).toContain("enum: ['BDT']")
    expect(contract).toContain("LEGACY_FINANCE_CURRENCY = 'BDT'")
  })

  it('uses the canonical money conversion boundary', () => {
    expect(moneyToMinorUnits(1250.5, 'amount')).toBe(125050)
    expect(moneyToMinorUnits(0.1 + 0.2, 'amount')).toBe(30)
    expect(moneyFromMinorUnits(125050)).toBe(1250.5)
    for (const relative of [
      'src/app/module/finance/finance.validation.ts',
      'src/app/module/finance/financeGlIntegration.service.ts',
      'src/app/module/finance/financeReporting.service.ts',
    ]) {
      const source = read(relative)
      expect(source).not.toMatch(/amount\s*\*\s*100\b/)
      expect(source).not.toMatch(/minor\w*\s*\/\s*100\b/i)
    }
  })

  it('enforces one PRIMARY journal per tenant/source identity', () => {
    const model = read('src/app/module/finance/financeAccounting.model.ts')
    const posting = read('src/app/module/finance/accountingPosting.service.ts')
    expect(model).toContain("organizationId: 1, sourceType: 1, sourceId: 1, entryRole: 1")
    expect(model).toContain("name: 'finance_journal_tenant_source_primary_unique'")
    expect(posting).toContain('financePostingIdentity')
    expect(posting).toContain('DUPLICATE')
    expect(posting).toContain("entryRole: 'PRIMARY'")
  })

  it('registers every automated Finance posting family in one contract', () => {
    const contract = read('src/app/module/finance/finance.contract.ts')
    for (const sourceType of [
      'MANUAL_TRANSACTION', 'INVOICE_REVENUE', 'INVOICE_PAYMENT', 'COMMISSION_ACCRUAL', 'COMMISSION_PAYOUT',
      'VENDOR_BILL', 'VENDOR_BILL_PAYMENT', 'CLIENT_DEPOSIT_RECEIPT', 'BANK_TRANSFER',
      'EQUITY_CAPITAL_CONTRIBUTION', 'SHAREHOLDER_LOAN_RECEIPT', 'DIVIDEND_DECLARATION', 'COMPANY_LOAN_RECEIPT',
    ]) expect(contract).toContain(`'${sourceType}'`)
  })

  it('standardizes public Finance error codes', () => {
    const contract = read('src/app/module/finance/finance.contract.ts')
    for (const code of [
      'FINANCE_PERMISSION_REQUIRED', 'ENTITLEMENT_REQUIRED', 'ACCOUNTING_MIGRATION_REQUIRED',
      'ACCOUNTING_MIGRATION_IN_PROGRESS', 'ACCOUNTING_CURRENCY_MISMATCH', 'ACCOUNTING_PERIOD_CLOSED',
      'ACCOUNTING_NOT_INITIALIZED', 'ACCOUNTING_UNBALANCED', 'INVALID_ACCOUNT_MAPPING', 'DUPLICATE_ACCOUNTING_POSTING',
    ]) expect(contract).toContain(code)
  })

  it('ships explicit read-only reconciliation and guarded repair tooling', () => {
    const reconcile = read('src/app/db/reconcileFinancePhase2.ts')
    const repair = read('src/app/db/repairFinancePhase2.ts')
    expect(reconcile).toContain("readOnly: true")
    expect(reconcile).toContain('AR_RECONCILIATION_MISMATCH')
    expect(reconcile).toContain('AP_RECONCILIATION_MISMATCH')
    expect(reconcile).toContain('COMMISSION_RECONCILIATION_MISMATCH')
    expect(repair).toContain("process.argv.includes('--apply')")
    expect(repair).toContain('Refusing automatic currency repair')
  })
})
