export const MONEY_SCALE = 100

export type InvoiceMoneyLineInput = {
  description: string
  quantity: number
  unitPrice: number
}

export type NormalizedInvoiceMoneyLine = InvoiceMoneyLineInput & {
  amount: number
}

export class FinanceMoneyValidationError extends Error {
  public readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = 'FinanceMoneyValidationError'
    this.field = field
  }
}

export const moneyToMinorUnits = (value: number, field: string) => {
  if (!Number.isFinite(value)) throw new FinanceMoneyValidationError(field, 'Enter a valid number')
  const minorUnits = Math.round((value + Math.sign(value) * Number.EPSILON) * MONEY_SCALE)
  if (!Number.isSafeInteger(minorUnits)) throw new FinanceMoneyValidationError(field, 'Amount is too large to calculate safely')
  return minorUnits
}

export const moneyFromMinorUnits = (minorUnits: number) => minorUnits / MONEY_SCALE

export const calculateInvoiceMoney = (lineItems: InvoiceMoneyLineInput[], discount = 0) => {
  let subtotalMinor = 0
  const normalized: NormalizedInvoiceMoneyLine[] = lineItems.map((item, index) => {
    const quantity = Number(item.quantity)
    const unitPrice = Number(item.unitPrice)
    const quantityField = `lineItems.${index}.quantity`
    const unitPriceField = `lineItems.${index}.unitPrice`

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new FinanceMoneyValidationError(quantityField, 'Quantity must be greater than zero')
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new FinanceMoneyValidationError(unitPriceField, 'Enter a valid rate of zero or more')
    }

    const unitPriceMinor = moneyToMinorUnits(unitPrice, unitPriceField)
    const amountMinor = Math.round(quantity * unitPriceMinor)
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
      throw new FinanceMoneyValidationError(unitPriceField, 'Calculated line amount is too large')
    }
    if (!Number.isSafeInteger(subtotalMinor + amountMinor)) {
      throw new FinanceMoneyValidationError(unitPriceField, 'Invoice subtotal is too large to calculate safely')
    }

    subtotalMinor += amountMinor
    return {
      description: item.description.trim(),
      quantity,
      unitPrice: moneyFromMinorUnits(unitPriceMinor),
      amount: moneyFromMinorUnits(amountMinor),
    }
  })

  const discountNumber = Number(discount || 0)
  if (!Number.isFinite(discountNumber)) throw new FinanceMoneyValidationError('discount', 'Enter a valid discount')
  if (discountNumber < 0) throw new FinanceMoneyValidationError('discount', 'Discount cannot be negative')
  const discountMinor = moneyToMinorUnits(discountNumber, 'discount')
  if (discountMinor > subtotalMinor) throw new FinanceMoneyValidationError('discount', 'Discount cannot exceed subtotal')

  const totalMinor = subtotalMinor - discountMinor
  if (totalMinor < 0) throw new FinanceMoneyValidationError('discount', 'Invoice total cannot be negative')

  return {
    lineItems: normalized,
    subtotal: moneyFromMinorUnits(subtotalMinor),
    discount: moneyFromMinorUnits(discountMinor),
    total: moneyFromMinorUnits(totalMinor),
  }
}
