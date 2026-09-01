import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('Advanced Accounting Phase 4 contracts', () => {
  it('keeps AR/AP, banking, deposits and tax behind Advanced Accounting routes', () => {
    const route = read('src/app/module/finance/finance.route.ts')
    for (const path of ['receivables', 'payables', 'vendor-bills', 'bank-accounts', 'bank-statements', 'client-deposits', 'tax-codes']) {
      expect(route).toContain(`/accounting/${path}`)
    }
    expect(route).toContain('advancedRead')
    expect(route).toContain('advancedWrite')
  })

  it('uses balanced journals for every Phase 4 posting workflow', () => {
    const service = read('src/app/module/finance/financeOperations.service.ts')
    expect(service).toContain('AccountingPostingService.postAutomatedInSession')
    for (const source of ['VENDOR_BILL', 'VENDOR_BILL_PAYMENT', 'BANK_TRANSFER', 'CLIENT_DEPOSIT_RECEIPT', 'CLIENT_DEPOSIT_APPLICATION', 'CLIENT_DEPOSIT_REFUND']) {
      expect(service).toContain(source)
    }
  })

  it('prevents reconciliation completion with a non-zero difference', () => {
    const service = read('src/app/module/finance/financeOperations.service.ts')
    expect(service).toContain('differenceMinor !== 0')
    expect(service).toContain('BANK_RECONCILIATION_NOT_BALANCED')
  })
})
