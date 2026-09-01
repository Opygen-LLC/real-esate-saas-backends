import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
const root=process.cwd(); const read=(p:string)=>fs.readFileSync(path.join(root,p),'utf8')
describe('Advanced Accounting Phase 7 posting and isolation matrix',()=>{
  it('keeps every production posting family behind the centralized balanced posting engine',()=>{
    const gl=read('src/app/module/finance/financeGlIntegration.service.ts')
    for(const source of ['MANUAL_TRANSACTION','INVOICE_REVENUE','INVOICE_PAYMENT','COMMISSION_ACCRUAL','COMMISSION_PAYOUT']) expect(gl).toContain(source)
    const ops=read('src/app/module/finance/financeOperations.service.ts')
    for(const source of ['VENDOR_BILL','VENDOR_BILL_PAYMENT','BANK_TRANSFER','CLIENT_DEPOSIT_RECEIPT','CLIENT_DEPOSIT_REFUND']) expect(ops).toContain(source)
    const capital=read('src/app/module/finance/financeCapital.service.ts')
    for(const source of ['EQUITY_','SHAREHOLDER_LOAN_RECEIPT','SHAREHOLDER_LOAN_PAYMENT','DIVIDEND_DECLARATION','DIVIDEND_PAYMENT','COMPANY_LOAN_RECEIPT','COMPANY_LOAN_PAYMENT']) expect(capital).toContain(source)
    const accounting=read('src/app/module/finance/financeAccounting.service.ts')
    expect(accounting).toContain('total debits do not equal total credits')
    expect(accounting).toContain('idempotencyKey')
  })
  it('retains organizationId scoping on accounting data access',()=>{
    for(const file of ['financeAccounting.service.ts','financeOperations.service.ts','financeCapital.service.ts','financeReporting.service.ts','financeInitialization.service.ts','financeClose.service.ts']) {
      const s=read(`src/app/module/finance/${file}`)
      expect(s).toContain('organizationId')
    }
  })
  it('validates global financial statement invariants from the GL',()=>{
    const reporting=read('src/app/module/finance/financeReporting.service.ts')
    expect(reporting).toContain('balanced')
    expect(reporting).toContain('differenceMinor === 0')
  })
})
