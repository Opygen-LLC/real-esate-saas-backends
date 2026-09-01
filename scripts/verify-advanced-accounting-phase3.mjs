import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const finance = read('src/app/module/finance/finance.service.ts')
const gl = read('src/app/module/finance/financeGlIntegration.service.ts')
const posting = read('src/app/module/finance/accountingPosting.service.ts')
const mapping = read('src/app/module/finance/financeCategoryMapping.service.ts')
const model = read('src/app/module/finance/finance.model.ts')
const accountingModel = read('src/app/module/finance/financeAccounting.model.ts')
const route = read('src/app/module/finance/finance.route.ts')
const purge = read('src/app/module/compliance/tenantDataCollections.ts')

// All automated entries continue through the single Phase 2 posting engine.
assert.match(gl, /AccountingPostingService\.postAutomatedInSession/)
assert.match(posting, /DUPLICATE|sourceType, sourceId/)
assert.match(posting, /advancedAccounting/)

// Invoice recognition and payment clearing use distinct source types/accounts.
assert.match(gl, /INVOICE_REVENUE/)
assert.match(gl, /accountsReceivable/)
assert.match(gl, /commissionRevenue/)
assert.match(gl, /INVOICE_PAYMENT/)
assert.match(gl, /bank/)
assert.match(finance, /postInvoiceRevenue/)
assert.match(finance, /postInvoicePayment/)

// Manual money and commissions are posted into the GL.
assert.match(gl, /MANUAL_TRANSACTION/)
assert.match(gl, /COMMISSION_ACCRUAL/)
assert.match(gl, /COMMISSION_PAYOUT/)
assert.match(gl, /commissionExpense/)
assert.match(gl, /commissionPayable/)
assert.match(finance, /postManualTransaction/)
assert.match(finance, /postCommissionAccrual/)
assert.match(finance, /postCommissionPayout/)

// Legacy records retain traceability to their accounting entries.
for (const field of ['accountingVersion', 'accountingJournalId', 'revenueJournalId', 'journalEntryId', 'accrualJournalId', 'payoutJournalId']) {
  assert.ok(model.includes(field), `Missing finance GL trace field ${field}`)
}

// Category mappings are tenant scoped and configurable.
assert.match(accountingModel, /FinanceCategoryAccountMapping/)
assert.match(mapping, /GENERAL_OPERATING_EXPENSE/)
assert.match(mapping, /finance\.category_mapping_updated/)
assert.ok(route.includes('/accounting/category-mappings'))

// Property dimensions are propagated to the generated journal lines.
assert.match(gl, /propertyId/)

// Lower plans / non-initialized tenants remain on legacy finance only.
assert.match(gl, /isAutomaticPostingReady/)
assert.match(gl, /advancedAccounting/)
assert.match(gl, /ASSETS_ROOT/)

assert.ok(purge.includes('financecategoryaccountmappings'), 'Tenant purge must include finance category mappings')
console.log('Advanced Accounting Phase 3 source contracts verified.')
