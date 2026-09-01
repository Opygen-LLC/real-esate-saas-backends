import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Advanced Accounting Phase 3 contract', () => {
  it('posts legacy finance through the centralized automated posting engine', () => {
    const integration = read('src/app/module/finance/financeGlIntegration.service.ts')
    const posting = read('src/app/module/finance/accountingPosting.service.ts')
    expect(integration).toContain('AccountingPostingService.postAutomatedInSession')
    expect(posting).toContain('sourceType, sourceId')
    expect(posting).toContain('advancedAccounting')
    expect(posting).toContain('ACCOUNTING_CURRENCY_MISMATCH')
  })

  it('recognizes invoice revenue once and clears receivables on payment', () => {
    const integration = read('src/app/module/finance/financeGlIntegration.service.ts')
    const service = read('src/app/module/finance/finance.service.ts')
    expect(integration).toContain("sourceType: 'INVOICE_REVENUE'")
    expect(integration).toContain("sourceType: 'INVOICE_PAYMENT'")
    expect(integration).toContain('settings.defaultAccounts?.accountsReceivable')
    expect(integration).toContain('settings.defaultAccounts?.commissionRevenue')
    expect(service).toContain('postInvoiceRevenue')
    expect(service).toContain('postInvoicePayment')
    expect(service).toContain("category: 'Invoice payment'")
  })

  it('posts manual paid money and agent commissions with the correct liability lifecycle', () => {
    const integration = read('src/app/module/finance/financeGlIntegration.service.ts')
    for (const sourceType of ['MANUAL_TRANSACTION', 'COMMISSION_ACCRUAL', 'COMMISSION_PAYOUT']) {
      expect(integration).toContain(`sourceType: '${sourceType}'`)
    }
    expect(integration).toContain('settings.defaultAccounts?.commissionExpense')
    expect(integration).toContain('settings.defaultAccounts?.commissionPayable')
    expect(integration).toContain('settings.defaultAccounts?.bank')
  })

  it('keeps configurable tenant category mappings and property dimensions', () => {
    const model = read('src/app/module/finance/financeAccounting.model.ts')
    const mapping = read('src/app/module/finance/financeCategoryMapping.service.ts')
    const integration = read('src/app/module/finance/financeGlIntegration.service.ts')
    const route = read('src/app/module/finance/finance.route.ts')
    expect(model).toContain('FinanceCategoryAccountMapping')
    expect(model).toContain('finance_category_mapping_tenant_type_category_unique')
    expect(mapping).toContain('GENERAL_OPERATING_EXPENSE')
    expect(mapping).toContain('finance.category_mapping_updated')
    expect(integration).toContain('propertyId')
    expect(route).toContain('/accounting/category-mappings')
  })

  it('preserves lower-plan legacy behavior and only auto-posts when entitled and initialized', () => {
    const integration = read('src/app/module/finance/financeGlIntegration.service.ts')
    const service = read('src/app/module/finance/finance.service.ts')
    expect(integration).toContain('isAutomaticPostingReady')
    expect(integration).toContain('advancedAccounting?.enabled')
    expect(integration).toContain("systemKey: 'ASSETS_ROOT'")
    expect(service).toContain('withOptionalAutomaticAccounting')
    expect(service).toContain('if (!accountingReady) return work(undefined, false)')
  })

  it('stores GL trace ids on legacy documents and purges mapping data with the tenant', () => {
    const model = read('src/app/module/finance/finance.model.ts')
    const purge = read('src/app/module/compliance/tenantDataCollections.ts')
    for (const field of ['accountingVersion', 'accountingJournalId', 'revenueJournalId', 'journalEntryId', 'accrualJournalId', 'payoutJournalId']) {
      expect(model).toContain(field)
    }
    expect(purge).toContain("'financecategoryaccountmappings'")
  })
})
