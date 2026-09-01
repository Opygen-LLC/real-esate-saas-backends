import fs from 'node:fs'
const required = [
  'src/app/module/finance/financeInitialization.service.ts','src/app/module/finance/financeClose.service.ts',
  'src/app/module/finance/financeInitialization.model.ts','src/app/module/finance/finance.route.ts',
  'src/tests/contract/advancedAccountingPhase7.contract.test.ts'
]
const missing = required.filter((p) => !fs.existsSync(p))
if (missing.length) { console.error('Phase 7 verification failed. Missing:', missing); process.exit(1) }
const route = fs.readFileSync('src/app/module/finance/finance.route.ts','utf8')
for (const token of ['/initialization/activate','/close-checklist','/year-end-close','/accounting/audit','finance.journal.approve']) {
  if (!route.includes(token)) { console.error(`Phase 7 verification failed: ${token}`); process.exit(1) }
}
console.log('Advanced Accounting Phase 7 source verification passed.')
