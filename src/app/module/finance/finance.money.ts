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

const PERCENT_SCALE = 10_000
const PERCENT_DENOMINATOR = 100 * PERCENT_SCALE

const normalizePercent = (value: number, field: string, options: { allowZero?: boolean } = {}) => {
  if (!Number.isFinite(value)) throw new FinanceMoneyValidationError(field, 'Enter a valid percentage')
  if (value < 0 || value > 100) throw new FinanceMoneyValidationError(field, 'Percentage must be between 0 and 100')
  if (!options.allowZero && value <= 0) throw new FinanceMoneyValidationError(field, 'Percentage must be greater than zero')
  const scaled = Math.round(value * PERCENT_SCALE)
  if (!Number.isSafeInteger(scaled)) throw new FinanceMoneyValidationError(field, 'Percentage is too precise to calculate safely')
  return scaled
}

const percentageOfMinorUnits = (amountMinor: number, percent: number, field: string, options: { allowZero?: boolean } = {}) => {
  const scaledPercent = normalizePercent(percent, field, options)
  const quotient = Math.floor(amountMinor / PERCENT_DENOMINATOR)
  const remainder = amountMinor % PERCENT_DENOMINATOR
  const whole = quotient * scaledPercent
  const fractional = Math.round((remainder * scaledPercent) / PERCENT_DENOMINATOR)
  const result = whole + fractional
  if (!Number.isSafeInteger(result) || result < 0) throw new FinanceMoneyValidationError(field, 'Calculated amount is too large')
  return result
}

export type AutomaticCommissionInput = {
  grossDealValue: number
  commissionRate: number
  agentSplitPercent: number
}

export const calculateAutomaticCommission = (input: AutomaticCommissionInput) => {
  const grossDealMinor = moneyToMinorUnits(Number(input.grossDealValue), 'grossDealValue')
  if (grossDealMinor <= 0) throw new FinanceMoneyValidationError('grossDealValue', 'Gross deal value must be greater than zero')

  const commissionMinor = percentageOfMinorUnits(grossDealMinor, Number(input.commissionRate), 'commissionRate')
  if (commissionMinor <= 0) throw new FinanceMoneyValidationError('commissionRate', 'Calculated commission must be greater than zero')

  const agentShareMinor = percentageOfMinorUnits(
    commissionMinor,
    Number(input.agentSplitPercent),
    'agentSplitPercent',
    { allowZero: true },
  )
  const companyShareMinor = commissionMinor - agentShareMinor

  return {
    grossDealValue: moneyFromMinorUnits(grossDealMinor),
    commissionRate: Math.round(Number(input.commissionRate) * PERCENT_SCALE) / PERCENT_SCALE,
    agentSplitPercent: Math.round(Number(input.agentSplitPercent) * PERCENT_SCALE) / PERCENT_SCALE,
    commissionAmount: moneyFromMinorUnits(commissionMinor),
    agentShare: moneyFromMinorUnits(agentShareMinor),
    companyShare: moneyFromMinorUnits(companyShareMinor),
  }
}

export type ManualCommissionInput = {
  grossDealValue: number
  commissionRate?: number
  commissionAmount: number
  agentShare: number
  companyShare: number
}

export const normalizeManualCommission = (input: ManualCommissionInput) => {
  const grossDealMinor = moneyToMinorUnits(Number(input.grossDealValue), 'grossDealValue')
  if (grossDealMinor < 0) throw new FinanceMoneyValidationError('grossDealValue', 'Gross deal value cannot be negative')

  if (input.commissionRate !== undefined) normalizePercent(Number(input.commissionRate), 'commissionRate', { allowZero: true })

  const commissionMinor = moneyToMinorUnits(Number(input.commissionAmount), 'commissionAmount')
  const agentShareMinor = moneyToMinorUnits(Number(input.agentShare), 'agentShare')
  const companyShareMinor = moneyToMinorUnits(Number(input.companyShare), 'companyShare')
  if (commissionMinor <= 0) throw new FinanceMoneyValidationError('commissionAmount', 'Enter a valid total commission amount')
  if (agentShareMinor < 0) throw new FinanceMoneyValidationError('agentShare', 'Enter a valid agent share')
  if (companyShareMinor < 0) throw new FinanceMoneyValidationError('companyShare', 'Enter a valid company share')
  if (agentShareMinor + companyShareMinor !== commissionMinor) {
    throw new FinanceMoneyValidationError('agentShare', 'Agent share and company share must equal the commission amount')
  }

  return {
    grossDealValue: moneyFromMinorUnits(grossDealMinor),
    commissionRate: input.commissionRate === undefined ? undefined : Math.round(Number(input.commissionRate) * PERCENT_SCALE) / PERCENT_SCALE,
    commissionAmount: moneyFromMinorUnits(commissionMinor),
    agentShare: moneyFromMinorUnits(agentShareMinor),
    companyShare: moneyFromMinorUnits(companyShareMinor),
  }
}
