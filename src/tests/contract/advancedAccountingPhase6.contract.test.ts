import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('Advanced Accounting Phase 6 reporting contracts', () => {
  it('exposes all GL financial statements behind the Advanced Accounting entitlement', () => {
    const route = read('src/app/module/finance/finance.route.ts')
    for (const endpoint of ['trial-balance','balance-sheet','profit-loss','cash-flow','statement-of-equity','general-ledger','ar-aging','ap-aging','property-profitability','tax','budget-vs-actual']) {
      expect(route).toContain(`/accounting/reports/${endpoint}`)
    }
    expect(route).toContain("requireEntitlement('ADVANCED_ACCOUNTING')")
    expect(route).toContain("/accounting/reports/export/:report")
    expect(route).toContain("/accounting/reports/drilldown")
  })

  it('derives statements from journal lines and checks core accounting equations', () => {
    const service = read('src/app/module/finance/financeReporting.service.ts')
    expect(service).toContain('FinanceJournalLine.aggregate')
    expect(service).toContain("journalStatus: { $in: POSTED_LINE_STATUSES }")
    expect(service).toContain('totals.periodDebitMinor === totals.periodCreditMinor')
    expect(service).toContain('differenceMinor === 0')
    expect(service).toContain('currentEarningsMinor')
    expect(service).toContain('netProfitMinor')
  })

  it('supports property profitability, tax, budget versus actual, and source drilldown', () => {
    const service = read('src/app/module/finance/financeReporting.service.ts')
    expect(service).toContain("propertyId: { $ne: null }")
    expect(service).toContain('FinanceTaxCode.find')
    expect(service).toContain('FinanceBudget.find')
    expect(service).toContain('sourceHref')
    expect(service).toContain('journalEntryId')
  })

  it('supports PDF CSV and XLSX exports', () => {
    const service = read('src/app/module/finance/financeReporting.service.ts')
    expect(service).toContain("format === 'csv'")
    expect(service).toContain("format === 'xlsx'")
    expect(service).toContain('PDFDocument.create')
    expect(service).toContain('ExcelJS.Workbook')
    expect(service).toContain('completeGeneralLedgerForExport')
    expect(service).toContain('100,000 rows')
    expect(service).toContain('pdfSafe')
    expect(service).toContain('/^[=+\\-@]/')
    const controller = read('src/app/module/finance/financeReporting.controller.ts')
    expect(controller).toContain("Content-Disposition")
    expect(controller).toContain("Cache-Control")
    expect(controller).toContain("private, no-store")
  })
})
