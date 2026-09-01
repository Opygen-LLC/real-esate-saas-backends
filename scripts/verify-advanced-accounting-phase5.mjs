import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const root = process.cwd(); const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const model = read('src/app/module/finance/financeCapital.model.ts'); const service = read('src/app/module/finance/financeCapital.service.ts'); const route = read('src/app/module/finance/finance.route.ts'); const purge = read('src/app/module/compliance/tenantDataCollections.ts'); const coa = read('src/app/module/finance/financeAccounting.service.ts')
for (const name of ['FinanceShareholder','FinanceEquityTransaction','FinanceShareholderLoan','FinanceDividend','FinanceLoan']) assert.ok(model.includes(name), `Missing Phase 5 model ${name}`)
for (const source of ['EQUITY_','SHAREHOLDER_LOAN_RECEIPT','SHAREHOLDER_LOAN_PAYMENT','DIVIDEND_DECLARATION','DIVIDEND_PAYMENT','COMPANY_LOAN_RECEIPT','COMPANY_LOAN_PAYMENT']) assert.ok(service.includes(source), `Missing Phase 5 posting source ${source}`)
for (const account of ['SHAREHOLDER_LOAN_PAYABLE','DIVIDEND_PAYABLE','INTEREST_EXPENSE']) assert.ok(service.includes(account), `Missing capital account ${account}`)
assert.match(service, /recalculateOwnership/); assert.match(service, /same share class/); assert.match(service, /sharesHeld/); assert.match(service, /ownershipPercentage/); assert.match(service, /outstandingPrincipalMinor/); assert.match(service, /principalMinor.*interestMinor/s); assert.match(service, /openingRetainedEarningsMinor/); assert.match(service, /closingRetainedEarningsMinor/); assert.match(service, /AccountingPostingService\.postAutomatedInSession/); assert.match(coa, /shareholderId/); assert.match(coa, /active shareholder loan uses it/); assert.match(coa, /active company loan uses it/)
for (const endpoint of ['/accounting/shareholders','/accounting/equity-transactions','/accounting/shareholder-loans','/accounting/dividends','/accounting/loans','/accounting/retained-earnings']) assert.ok(route.includes(endpoint), `Missing Phase 5 route ${endpoint}`)
for (const collection of ['financeshareholders','financeequitytransactions','financeshareholderloans','financedividends','financeloans']) assert.ok(purge.includes(collection), `Tenant purge missing ${collection}`)
console.log('Advanced Accounting Phase 5 source contracts verified.')
