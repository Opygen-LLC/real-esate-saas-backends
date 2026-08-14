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
