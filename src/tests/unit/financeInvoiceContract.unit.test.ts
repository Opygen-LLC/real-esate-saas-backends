import { describe, expect, it } from 'vitest'
import { FinanceValidation } from '../../app/module/finance/finance.validation'

const baseInvoice = {
  clientName: 'Contract Client',
  clientPhone: '',
  clientEmail: 'client@example.com',
  issueDate: '2026-09-09',
  lineItems: [{ description: 'Agency service', quantity: 1, unitPrice: 1000 }],
  discount: 0,
  status: 'draft' as const,
  notes: '',
}

describe('invoice write contract', () => {
  it('accepts null, empty, and omitted optional invoice relations with one normalized shape', () => {
    const parsedNull = FinanceValidation.createInvoice.parse({ body: { ...baseInvoice, dueDate: null, propertyId: null, leadId: null, taxCodeId: null } })
    expect(parsedNull.body.dueDate).toBeNull()
    expect(parsedNull.body.propertyId).toBeNull()
    expect(parsedNull.body.leadId).toBeNull()
    expect(parsedNull.body.taxCodeId).toBeNull()

    const parsedEmpty = FinanceValidation.createInvoice.parse({ body: { ...baseInvoice, dueDate: '', propertyId: '', leadId: '', taxCodeId: '' } })
    expect(parsedEmpty.body.dueDate).toBeNull()
    expect(parsedEmpty.body.propertyId).toBeNull()
    expect(parsedEmpty.body.leadId).toBeNull()
    expect(parsedEmpty.body.taxCodeId).toBeNull()

    const parsedOmitted = FinanceValidation.createInvoice.parse({ body: baseInvoice })
    expect(parsedOmitted.body.dueDate).toBeNull()
    expect(parsedOmitted.body.propertyId).toBeNull()
    expect(parsedOmitted.body.leadId).toBeNull()
    expect(parsedOmitted.body.taxCodeId).toBeNull()
  })

  it('keeps field-level paths for invalid invoice identifiers', () => {
    const parsed = FinanceValidation.createInvoice.safeParse({ body: { ...baseInvoice, taxCodeId: 'not-an-object-id' } })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(['body', 'taxCodeId'])
  })
})
