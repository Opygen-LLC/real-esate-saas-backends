import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
const root = process.cwd(); const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
describe('Advanced Accounting Phase 5 contracts', () => {
  it('keeps capital and financing routes behind Advanced Accounting', () => { const route = read('src/app/module/finance/finance.route.ts'); for (const path of ['shareholders','equity-transactions','shareholder-loans','dividends','loans','retained-earnings']) expect(route).toContain(`/accounting/${path}`); expect(route).toContain('advancedRead'); expect(route).toContain('advancedWrite') })
  it('posts balanced capital, dividend and loan workflows through the central posting engine', () => { const service = read('src/app/module/finance/financeCapital.service.ts'); const coa = read('src/app/module/finance/financeAccounting.service.ts'); expect(service).toContain('AccountingPostingService.postAutomatedInSession')
    expect(coa).toContain('shareholderId')
    expect(coa).toContain('active shareholder loan uses it')
    expect(coa).toContain('active company loan uses it'); for (const source of ['SHAREHOLDER_LOAN_RECEIPT','SHAREHOLDER_LOAN_PAYMENT','DIVIDEND_DECLARATION','DIVIDEND_PAYMENT','COMPANY_LOAN_RECEIPT','COMPANY_LOAN_PAYMENT']) expect(service).toContain(source) })
  it('tracks ownership from shares and separates loan principal from interest', () => { const service = read('src/app/module/finance/financeCapital.service.ts'); expect(service).toContain('recalculateOwnership')
    expect(service).toContain('same share class'); expect(service).toContain('sharesHeld'); expect(service).toContain('outstandingPrincipalMinor'); expect(service).toContain('principalMinor'); expect(service).toContain('interestMinor') })
})
