import { describe, expect, it } from 'vitest'
import { classifyInvoiceFailure } from '../../shared/invoiceFailureTelemetry'

describe('Phase 4 invoice failure telemetry', () => {
  it.each([
    [400, 'VALIDATION_ERROR', 'validation'],
    [503, 'TRANSACTIONS_REQUIRED', 'transactions_required'],
    [409, 'FINANCE_ACCOUNT_MAPPING_REQUIRED', 'accounting_configuration'],
    [409, 'INVOICE_IDEMPOTENCY_KEY_REUSED', 'idempotency_conflict'],
    [403, 'FORBIDDEN', 'authorization'],
    [429, 'RATE_LIMITED', 'rate_limited'],
    [500, 'INTERNAL_ERROR', 'unexpected'],
  ])('classifies %s/%s as %s', (status, code, expected) => {
    expect(classifyInvoiceFailure(status as number, code as string)).toBe(expected)
  })
})
