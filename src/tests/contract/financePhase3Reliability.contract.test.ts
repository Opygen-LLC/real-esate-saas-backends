import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('Finance Phase 3 reliability contract', () => {
  it('session exposes accounting migration state for one central frontend capability resolver', () => {
    const auth = read('src/app/module/auth/auth.controller.ts')
    expect(auth).toContain('FinanceAccountingInitialization')
    expect(auth).toContain('migrationState')
    expect(auth).toContain("'ACTIVATING'")
    expect(auth).toContain("'MIGRATION_REQUIRED'")
    expect(auth).toContain("'LOCKED_READ_ONLY'")
    expect(auth).toContain("'ACTIVE'")
    expect(auth).toContain("'UNINITIALIZED'")
  })

  it('Finance failures emit a structured production event with request correlation', () => {
    const events = read('src/shared/productionEvents.ts')
    const handler = read('src/app/middlewares/globalErrorHandler.ts')
    expect(events).toContain("'finance_request_failed'")
    expect(handler).toContain("route.includes('/finance')")
    expect(handler).toContain('[403, 409, 422, 500]')
    expect(handler).toContain("emitProductionEvent('finance_request_failed'")
    expect(handler).toContain('requestId: req.requestId')
    expect(handler).toContain('errorCode: code')
  })

  it('CI has a real-database accounting integrity matrix and a read-only production verifier', () => {
    const integrity = read('src/tests/integration/financePhase3Integrity.integration.test.ts')
    for (const invariant of [
      'INVOICE_REVENUE', 'INVOICE_PAYMENT', 'COMMISSION_ACCRUAL', 'COMMISSION_PAYOUT',
      'createVendorBill', 'payVendorBill', 'transferBankFunds', 'reverseJournal',
      'DUPLICATE_ACCOUNTING_POSTING', 'ACCOUNTING_PERIOD_CLOSED',
      'trialBalance.balanced', 'balanceSheet.summary.balanced',
    ]) expect(integrity).toContain(invariant)
    const verifier = read('src/app/db/verifyFinancePhase3Production.ts')
    expect(verifier).toContain("verification: 'finance-phase3-production-read-only'")
    expect(verifier).toContain('readOnly: true')
    expect(verifier).toContain('DUPLICATE_ACCOUNTING_POSTING')
    expect(verifier).toContain('ACCOUNTING_UNBALANCED')
    expect(verifier).toContain('ACCOUNTING_EQUATION_MISMATCH')
  })

  it('invoice creation is idempotent, audits inside the transaction, and production health checks use readiness', () => {
    const service = read('src/app/module/finance/finance.service.ts')
    const model = read('src/app/module/finance/finance.model.ts')
    const controller = read('src/app/module/finance/finance.controller.ts')
    const financeContract = read('src/app/module/finance/finance.contract.ts')
    const dockerfile = read('Dockerfile')
    const compose = read('docker-compose.production.yml')
    expect(controller).toContain("req.headers['idempotency-key']")
    expect(model).toContain('finance_invoice_tenant_creation_idempotency_unique')
    expect(service).toContain('creationRequestHash')
    expect(service).toContain('invoiceAudit(')
    expect(service).toContain('TransactionalOutbox.emit(eventInput, session)')
    expect(service).toContain('FINANCE_ERROR_CODES.invoiceAccountMappingRequired')
    expect(financeContract).toContain("invoiceAccountMappingRequired: 'FINANCE_ACCOUNT_MAPPING_REQUIRED'")
    expect(dockerfile).toContain('http://127.0.0.1:5000/ready')
    expect(compose).toContain('http://127.0.0.1:5000/ready')
  })

  it('package gates keep database integration and production verification explicit', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts['test:finance-phase3:contract']).toBeTruthy()
    expect(pkg.scripts['test:finance-phase3:integration']).toContain('TEST_DATABASE_URL')
    expect(pkg.scripts['verify:finance-phase3-production']).toContain('verifyFinancePhase3Production.ts')
    expect(pkg.scripts['gate:finance-phase3']).toContain('typecheck')
    expect(pkg.scripts['gate:finance-phase3:staging']).toContain('audit:finance')
    expect(pkg.scripts['gate:finance-phase3:staging']).toContain('reconcile:finance-phase2')
    expect(pkg.scripts['gate:finance-phase3:staging']).toContain('test:smtp')
  })
})
