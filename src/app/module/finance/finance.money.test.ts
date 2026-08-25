import { describe, expect, it } from 'vitest'
import { calculateAutomaticCommission, calculateInvoiceMoney, FinanceMoneyValidationError, normalizeManualCommission } from './finance.money'

describe('finance invoice money calculations', () => {
  it('calculates line amounts, subtotal, discount and total in two-decimal minor units', () => {
    const result = calculateInvoiceMoney([
      { description: 'Brokerage service', quantity: 1, unitPrice: 50000 },
      { description: 'Documentation', quantity: 2, unitPrice: 5000 },
    ], 5000)

    expect(result.lineItems.map((item) => item.amount)).toEqual([50000, 10000])
    expect(result.subtotal).toBe(60000)
    expect(result.discount).toBe(5000)
    expect(result.total).toBe(55000)
  })

  it('rounds currency to two decimal places before multiplying', () => {
    const result = calculateInvoiceMoney([
      { description: 'Fractional fee', quantity: 1, unitPrice: 0.005 },
    ], 0)
    expect(result.lineItems[0].unitPrice).toBe(0.01)
    expect(result.lineItems[0].amount).toBe(0.01)
    expect(result.total).toBe(0.01)
  })

  it('rejects zero quantity, invalid rate and over-discount with field paths', () => {
    expect(() => calculateInvoiceMoney([{ description: 'Fee', quantity: 0, unitPrice: 100 }], 0))
      .toThrowError(expect.objectContaining({ field: 'lineItems.0.quantity' }))
    expect(() => calculateInvoiceMoney([{ description: 'Fee', quantity: 1, unitPrice: Number.NaN }], 0))
      .toThrowError(expect.objectContaining({ field: 'lineItems.0.unitPrice' }))

    try {
      calculateInvoiceMoney([{ description: 'Fee', quantity: 1, unitPrice: 50000 }], 60000)
      throw new Error('Expected discount validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(FinanceMoneyValidationError)
      expect((error as FinanceMoneyValidationError).field).toBe('discount')
      expect((error as Error).message).toBe('Discount cannot exceed subtotal')
    }
  })
})


describe('finance commission calculations', () => {
  it('derives total commission and agent/company split using two-decimal money arithmetic', () => {
    const result = calculateAutomaticCommission({
      grossDealValue: 20_000_000,
      commissionRate: 2.5,
      agentSplitPercent: 60,
    })

    expect(result.commissionAmount).toBe(500_000)
    expect(result.agentShare).toBe(300_000)
    expect(result.companyShare).toBe(200_000)
  })

  it('rounds automatic commission values to two decimals and keeps the split exact', () => {
    const result = calculateAutomaticCommission({
      grossDealValue: 123_456.78,
      commissionRate: 2.375,
      agentSplitPercent: 61.5,
    })

    expect(Number((result.agentShare + result.companyShare).toFixed(2))).toBe(result.commissionAmount)
    expect(Number(result.commissionAmount.toFixed(2))).toBe(result.commissionAmount)
  })

  it('rejects invalid automatic percentages with field-specific errors', () => {
    expect(() => calculateAutomaticCommission({ grossDealValue: 1_000_000, commissionRate: 0, agentSplitPercent: 60 }))
      .toThrowError(expect.objectContaining({ field: 'commissionRate' }))
    expect(() => calculateAutomaticCommission({ grossDealValue: 1_000_000, commissionRate: 2.5, agentSplitPercent: 101 }))
      .toThrowError(expect.objectContaining({ field: 'agentSplitPercent' }))
  })

  it('validates manual override shares in exact minor units', () => {
    expect(() => normalizeManualCommission({
      grossDealValue: 20_000_000,
      commissionRate: 2.5,
      commissionAmount: 500_000,
      agentShare: 300_000,
      companyShare: 199_999.99,
    })).toThrowError(expect.objectContaining({ field: 'agentShare' }))

    const result = normalizeManualCommission({
      grossDealValue: 20_000_000,
      commissionRate: 2.5,
      commissionAmount: 500_000,
      agentShare: 300_000,
      companyShare: 200_000,
    })
    expect(result.companyShare).toBe(200_000)
  })
})
