import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'

/**
 * Phase 2 canonical Finance contract.
 *
 * Legacy Finance stores major-unit BDT values while the General Ledger stores
 * integer minor units. Until the whole Finance domain is migrated to an
 * explicit multi-currency model, BDT is the only safe ledger currency.
 */
export const LEGACY_FINANCE_CURRENCY = 'BDT' as const
export type LegacyFinanceCurrency = typeof LEGACY_FINANCE_CURRENCY

export const FINANCE_ERROR_CODES = {
  permissionRequired: 'FINANCE_PERMISSION_REQUIRED',
  entitlementRequired: 'ENTITLEMENT_REQUIRED',
  migrationRequired: 'ACCOUNTING_MIGRATION_REQUIRED',
  migrationInProgress: 'ACCOUNTING_MIGRATION_IN_PROGRESS',
  currencyMismatch: 'ACCOUNTING_CURRENCY_MISMATCH',
  periodClosed: 'ACCOUNTING_PERIOD_CLOSED',
  notInitialized: 'ACCOUNTING_NOT_INITIALIZED',
  unbalanced: 'ACCOUNTING_UNBALANCED',
  invalidAccountMapping: 'INVALID_ACCOUNT_MAPPING',
  duplicatePosting: 'DUPLICATE_ACCOUNTING_POSTING',
} as const

export type FinanceErrorCode = typeof FINANCE_ERROR_CODES[keyof typeof FINANCE_ERROR_CODES]

/**
 * All source types that are posted through AccountingPostingService.
 * Mutable legacy records include a version in sourceId, so each economic
 * posting event still has one stable (organizationId, sourceType, sourceId)
 * identity while revisions are represented by a reversal plus a new version.
 */

export type FinancePermission =
  | 'finance.read'
  | 'finance.write'
  | 'finance.delete'
  | 'finance.accounting.read'
  | 'finance.accounts.manage'
  | 'finance.journal.create'
  | 'finance.journal.approve'
  | 'finance.journal.post'
  | 'finance.journal.reverse'
  | 'finance.period.close'
  | 'finance.period.reopen'
  | 'finance.audit.read'
  | 'finance.reports.read'
  | 'finance.reports.export'
  | 'finance.tax.manage'
  | 'finance.bank.manage'
  | 'finance.bank.reconcile'
  | 'finance.payables.manage'
  | 'finance.receivables.manage'
  | 'finance.shareholders.read'
  | 'finance.shareholders.manage'
  | 'finance.loans.manage'

export const FINANCE_RECONCILIATION_SOURCE_FAMILIES = [
  'MANUAL_TRANSACTION',
  'INVOICE_REVENUE',
  'INVOICE_PAYMENT',
  'COMMISSION_ACCRUAL',
  'COMMISSION_PAYOUT',
  'VENDOR_BILL',
  'CLIENT_DEPOSIT',
  'BANK_TRANSFER',
  'EQUITY',
  'LOAN',
  'DIVIDEND',
  'PROPERTY_INVESTOR_CONTRIBUTION',
  'PROPERTY_INVESTOR_DISTRIBUTION',
  'OPENING_BALANCE',
] as const

export const FINANCE_AUTOMATED_JOURNAL_SOURCE_TYPES = [
  'MANUAL_TRANSACTION',
  'INVOICE_REVENUE',
  'INVOICE_PAYMENT',
  'COMMISSION_ACCRUAL',
  'COMMISSION_PAYOUT',
  'BANK_TRANSFER',
  'VENDOR_BILL',
  'VENDOR_BILL_PAYMENT',
  'CLIENT_DEPOSIT_RECEIPT',
  'CLIENT_DEPOSIT_APPLICATION',
  'CLIENT_DEPOSIT_REFUND',
  'EQUITY_CAPITAL_CONTRIBUTION',
  'EQUITY_SHARE_ISSUE',
  'EQUITY_SHARE_BUYBACK',
  'EQUITY_CAPITAL_RETURN',
  'EQUITY_OWNER_DRAW',
  'SHAREHOLDER_LOAN_RECEIPT',
  'SHAREHOLDER_LOAN_PAYMENT',
  'DIVIDEND_DECLARATION',
  'DIVIDEND_PAYMENT',
  'PROPERTY_INVESTOR_CONTRIBUTION',
  'PROPERTY_INVESTOR_CAPITAL_RETURN',
  'PROPERTY_INVESTOR_PROFIT_DISTRIBUTION',
  'COMPANY_LOAN_RECEIPT',
  'COMPANY_LOAN_PAYMENT',
] as const

export type FinanceAutomatedJournalSourceType = typeof FINANCE_AUTOMATED_JOURNAL_SOURCE_TYPES[number]

const AUTOMATED_SOURCE_SET = new Set<string>(FINANCE_AUTOMATED_JOURNAL_SOURCE_TYPES)

export const normalizeFinanceCurrency = (value: unknown) => String(value || '').trim().toUpperCase()

export const assertLegacyFinanceCurrency = (value: unknown, label = 'Accounting base currency'): LegacyFinanceCurrency => {
  const currency = normalizeFinanceCurrency(value || LEGACY_FINANCE_CURRENCY)
  if (currency !== LEGACY_FINANCE_CURRENCY) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `${label} must be ${LEGACY_FINANCE_CURRENCY} while legacy Finance is enabled`,
      '',
      FINANCE_ERROR_CODES.currencyMismatch,
      { expectedCurrency: LEGACY_FINANCE_CURRENCY, actualCurrency: currency || null },
    )
  }
  return LEGACY_FINANCE_CURRENCY
}

export const normalizeAutomatedJournalSourceType = (value: unknown): FinanceAutomatedJournalSourceType => {
  const sourceType = String(value || '').trim().toUpperCase()
  if (!AUTOMATED_SOURCE_SET.has(sourceType)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Automated accounting source type is invalid')
  }
  return sourceType as FinanceAutomatedJournalSourceType
}

export const normalizeAccountingSourceId = (value: unknown) => {
  const sourceId = String(value || '').trim()
  if (!sourceId) throw new ApiError(httpStatus.BAD_REQUEST, 'Automated accounting source id is required')
  if (sourceId.length > 160) throw new ApiError(httpStatus.BAD_REQUEST, 'Automated accounting source id is too long')
  return sourceId
}

export const financePostingIdentity = (sourceType: FinanceAutomatedJournalSourceType, sourceId: string) => ({
  sourceType,
  sourceId,
  idempotencyKey: `${sourceType}:${sourceId}`,
})
