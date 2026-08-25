import { describe, expect, it } from 'vitest'
import { calculateInvoiceMoney, FinanceMoneyValidationError } from './finance.money'

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
