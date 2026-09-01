import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const model = read('src/app/module/finance/financeOperations.model.ts')
const service = read('src/app/module/finance/financeOperations.service.ts')
const route = read('src/app/module/finance/finance.route.ts')
const gl = read('src/app/module/finance/financeGlIntegration.service.ts')
const finance = read('src/app/module/finance/finance.service.ts')
const purge = read('src/app/module/compliance/tenantDataCollections.ts')

for (const name of ['FinanceBankAccount','FinanceVendorBill','FinanceBankTransfer','FinanceBankStatement','FinanceBankStatementLine','FinanceReconciliation','FinanceClientDeposit','FinanceTaxCode']) {
  assert.ok(model.includes(name), `Missing Phase 4 model ${name}`)
}
for (const source of ['VENDOR_BILL','VENDOR_BILL_PAYMENT','BANK_TRANSFER','CLIENT_DEPOSIT_RECEIPT','CLIENT_DEPOSIT_APPLICATION','CLIENT_DEPOSIT_REFUND']) {
  assert.ok(service.includes(source), `Missing automated posting source ${source}`)
}
assert.match(service, /receivables/)
assert.match(service, /days1to30/)
assert.match(service, /payables/)
assert.match(service, /BANK_RECONCILIATION_NOT_BALANCED/)
assert.match(service, /Only CSV and XLSX/)
assert.match(service, /differenceMinor !== 0/)
assert.match(service, /AccountingPostingService\.postAutomatedInSession/)
assert.match(gl, /taxAmountMinor/)
assert.match(gl, /output tax/i)
assert.match(gl, /bankGlAccount/)
assert.match(finance, /applyInvoiceTax/)
assert.match(finance, /Tax\/VAT accounting requires Advanced Accounting/)
for (const endpoint of ['/accounting/receivables','/accounting/payables','/accounting/vendor-bills','/accounting/bank-accounts','/accounting/bank-transfers','/accounting/bank-statements','/accounting/client-deposits','/accounting/tax-codes']) {
  assert.ok(route.includes(endpoint), `Missing Phase 4 route ${endpoint}`)
}
for (const collection of ['financebankaccounts','financevendorbills','financebanktransfers','financebankstatements','financebankstatementlines','financereconciliations','financeclientdeposits','financetaxcodes']) {
  assert.ok(purge.includes(collection), `Tenant purge missing ${collection}`)
}
console.log('Advanced Accounting Phase 4 source contracts verified.')
