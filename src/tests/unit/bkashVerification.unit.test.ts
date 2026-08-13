import { describe, expect, it } from 'vitest'
import { ensurePaymentMatchesAttempt, isCompletedGatewayPayment, trustedBkashCheckoutUrl } from '../../app/module/bkashPayment/bkashPayment.verification'

const attempt = { paymentId: 'TR001', amount: 3490 }

describe('bKash verification invariants', () => {
  it('allows only HTTPS bKash checkout hosts', () => {
    expect(trustedBkashCheckoutUrl('https://tokenized.pay.bka.sh/checkout/abc')).toContain('bka.sh')
    expect(() => trustedBkashCheckoutUrl('https://evil.example/checkout')).toThrow(/invalid checkout URL/i)
    expect(() => trustedBkashCheckoutUrl('http://bkash.com/checkout')).toThrow(/invalid checkout URL/i)
  })

  it('accepts only completed successful gateway states', () => {
    expect(isCompletedGatewayPayment({ statusCode: '0000', transactionStatus: 'Completed' })).toBe(true)
    expect(isCompletedGatewayPayment({ statusCode: '9999', transactionStatus: 'Completed' })).toBe(false)
    expect(isCompletedGatewayPayment({ statusCode: '0000', transactionStatus: 'Initiated' })).toBe(false)
  })

  it('rejects mismatched payment id, currency, or amount', () => {
    expect(() => ensurePaymentMatchesAttempt({ paymentID: 'OTHER', statusCode: '0000', amount: '3490', currency: 'BDT' }, attempt as any)).toThrow(/ID mismatch/i)
    expect(() => ensurePaymentMatchesAttempt({ paymentID: 'TR001', statusCode: '0000', amount: '3490', currency: 'USD' }, attempt as any)).toThrow(/currency mismatch/i)
    expect(() => ensurePaymentMatchesAttempt({ paymentID: 'TR001', statusCode: '0000', amount: '3000', currency: 'BDT' }, attempt as any)).toThrow(/amount mismatch/i)
    expect(() => ensurePaymentMatchesAttempt({ paymentID: 'TR001', statusCode: '0000', amount: '3490.00', currency: 'BDT' }, attempt as any)).not.toThrow()
  })
})
