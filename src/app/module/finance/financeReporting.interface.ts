export type FinanceReportKey =
  | 'trial-balance'
  | 'balance-sheet'
  | 'profit-loss'
  | 'cash-flow'
  | 'statement-of-equity'
  | 'general-ledger'
  | 'ar-aging'
  | 'ap-aging'
  | 'property-profitability'
  | 'tax'
  | 'budget-vs-actual'

export type FinanceReportExportFormat = 'pdf' | 'csv' | 'xlsx'

export interface FinanceReportDateRange {
  startDate?: Date
  endDate: Date
}

export interface FinanceReportExport {
  buffer: Buffer
  contentType: string
  fileName: string
}
