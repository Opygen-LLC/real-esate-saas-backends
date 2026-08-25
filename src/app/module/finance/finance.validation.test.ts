import { describe, expect, it } from 'vitest'
import { FinanceValidation } from './finance.validation'

describe('FinanceValidation', () => {
  it('accepts a valid expense transaction', () => {
    const parsed = FinanceValidation.createTransaction.safeParse({ body: {
      type: 'expense', category: 'Marketing', amount: 2500, transactionDate: '2026-08-15',
      paymentMethod: 'bkash', status: 'paid', description: 'Facebook campaign',
    } })
    expect(parsed.success).toBe(true)
  })

  it('rejects zero or negative transaction amounts', () => {
    const parsed = FinanceValidation.createTransaction.safeParse({ body: {
      type: 'expense', category: 'Marketing', amount: 0, transactionDate: '2026-08-15',
      paymentMethod: 'cash', status: 'paid', description: 'Invalid amount',
    } })
    expect(parsed.success).toBe(false)
  })

  it('requires agent and company shares to match the commission amount', () => {
    const parsed = FinanceValidation.createCommission.safeParse({ body: {
      agentId: '64f0c1234567890abcdef123', grossDealValue: 10000000, commissionAmount: 200000,
      agentShare: 50000, companyShare: 100000, status: 'approved',
    } })
    expect(parsed.success).toBe(false)
  })

  it('rejects budgets whose end date is before the start date', () => {
    const parsed = FinanceValidation.createBudget.safeParse({ body: {
      name: 'Marketing budget', category: 'Marketing', amount: 100000, period: 'monthly',
      startDate: '2026-08-31', endDate: '2026-08-01', alertThresholdPercent: 80,
    } })
    expect(parsed.success).toBe(false)
  })
})

it('requires a reason when voiding an invoice', () => {
  expect(FinanceValidation.voidInvoice.safeParse({ body: { reason: 'Client cancelled before payment' } }).success).toBe(true)
  expect(FinanceValidation.voidInvoice.safeParse({ body: { reason: '' } }).success).toBe(false)
})

it('does not allow cancellation through the generic invoice update contract', () => {
  expect(FinanceValidation.updateInvoice.safeParse({ body: { status: 'cancelled' } }).success).toBe(false)
  expect(FinanceValidation.updateInvoice.safeParse({ body: { status: 'sent' } }).success).toBe(true)
})


it('requires the dedicated cancellation contract and rejects generic cancellation bypasses', () => {
  expect(FinanceValidation.cancelCommission.safeParse({ body: { reason: 'Deal cancelled before payout' } }).success).toBe(true)
  expect(FinanceValidation.cancelCommission.safeParse({ body: { reason: '' } }).success).toBe(false)
  expect(FinanceValidation.updateCommission.safeParse({ body: { status: 'cancelled' } }).success).toBe(false)
})


describe('invoice field-level validation', () => {
  const base = {
    clientName: 'Example Client',
    issueDate: '2026-08-25',
    dueDate: '2026-08-30',
    lineItems: [{ description: 'Brokerage service', quantity: 1, unitPrice: 50000 }],
    discount: 0,
  }

  it('reports dueDate when the due date is before the issue date', () => {
    const parsed = FinanceValidation.createInvoice.safeParse({ body: { ...base, dueDate: '2026-08-20' } })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.path.join('.') === 'body.dueDate')).toBe(true)
  })

  it('reports discount when discount exceeds the calculated subtotal', () => {
    const parsed = FinanceValidation.createInvoice.safeParse({ body: { ...base, discount: 60000 } })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.path.join('.') === 'body.discount')).toBe(true)
  })

  it('reports nested line item paths', () => {
    const parsed = FinanceValidation.createInvoice.safeParse({ body: { ...base, lineItems: [{ description: '', quantity: 0, unitPrice: -1 }] } })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join('.'))
      expect(paths).toContain('body.lineItems.0.description')
      expect(paths).toContain('body.lineItems.0.quantity')
      expect(paths).toContain('body.lineItems.0.unitPrice')
    }
  })
})
