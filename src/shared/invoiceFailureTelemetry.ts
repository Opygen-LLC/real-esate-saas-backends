export type InvoiceFailureClass =
  | 'validation'
  | 'transactions_required'
  | 'accounting_configuration'
  | 'idempotency_conflict'
  | 'authorization'
  | 'rate_limited'
  | 'unexpected'
  | 'other'

export const classifyInvoiceFailure = (statusCode: number, errorCode?: string): InvoiceFailureClass => {
  const code = String(errorCode || '').trim().toUpperCase()
  if (code === 'VALIDATION_ERROR') return 'validation'
  if (code === 'TRANSACTIONS_REQUIRED') return 'transactions_required'
  if (code === 'FINANCE_ACCOUNT_MAPPING_REQUIRED') return 'accounting_configuration'
  if (code === 'INVOICE_IDEMPOTENCY_KEY_REUSED' || code === 'INVOICE_IDEMPOTENCY_CONFLICT') return 'idempotency_conflict'
  if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN' || statusCode === 401 || statusCode === 403) return 'authorization'
  if (code === 'RATE_LIMITED' || statusCode === 429) return 'rate_limited'
  if (statusCode >= 500) return 'unexpected'
  return 'other'
}
