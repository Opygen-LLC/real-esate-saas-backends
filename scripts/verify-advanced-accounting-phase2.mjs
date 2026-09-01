import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const service = read('src/app/module/finance/financeAccounting.service.ts')
const model = read('src/app/module/finance/financeAccounting.model.ts')
const route = read('src/app/module/finance/finance.route.ts')
const posting = read('src/app/module/finance/accountingPosting.service.ts')

for (const symbol of ['FinanceAccount', 'FinanceFiscalYear', 'FinanceFiscalPeriod', 'FinanceJournalEntry', 'FinanceJournalLine']) assert.match(model, new RegExp(symbol))
assert.match(service, /JOURNAL_NOT_BALANCED/)
assert.match(service, /BigInt\(debitMinor\)/)
assert.match(service, /Posted or reversed journals are immutable/)
assert.match(service, /Only a posted journal can be reversed/)
assert.match(service, /FISCAL_PERIOD_CLOSED/)
assert.match(service, /DUPLICATE_ACCOUNTING_POSTING/)
assert.match(service, /FinanceJournalLine\.find\(filter\)/)
assert.match(service, /System accounts cannot be deleted/)
assert.match(posting, /ADVANCED_ACCOUNTING/)
assert.match(posting, /finance\.write/)
assert.match(route, /requireEntitlement\('ADVANCED_ACCOUNTING'\)/)
for (const endpoint of ['/accounting/accounts', '/accounting/fiscal-years', '/accounting/fiscal-periods', '/accounting/journals', '/accounting/opening-balances', '/accounting/general-ledger']) assert.ok(route.includes(endpoint), `Missing ${endpoint}`)
console.log('Advanced Accounting Phase 2 source contracts verified.')
