export type BillingCycle = 'monthly' | 'yearly'
export type TaxSettings = {
  invoiceEnabled?: boolean
  registrationStatus?: 'registered' | 'not_registered' | string
  operatorLegalName?: string
  binEncrypted?: string
  vatRate?: number
  pricesIncludeVat?: boolean
}

export type SubscriptionPriceInput = {
  priceMonthly: number
  priceYearly: number
  billingCycle: BillingCycle
  tax?: TaxSettings | null
}

export const calculateSubscriptionCharge = (input: SubscriptionPriceInput) => {
  const baseAmount = input.billingCycle === 'yearly' ? Number(input.priceYearly) : Number(input.priceMonthly)
  if (!Number.isFinite(baseAmount) || baseAmount < 1) throw new Error('Subscription plan price is invalid')

  const tax = input.tax
  const registered = Boolean(tax?.invoiceEnabled && tax.registrationStatus === 'registered')
  const vatRate = registered ? Math.max(0, Math.min(100, Number(tax?.vatRate || 0))) : 0
  const pricesIncludeVat = tax?.pricesIncludeVat ?? true
  const vatAmount = registered && !pricesIncludeVat
    ? baseAmount * vatRate / 100
    : registered && vatRate > 0
      ? baseAmount - baseAmount / (1 + vatRate / 100)
      : 0
  const amount = Number((baseAmount + (registered && !pricesIncludeVat ? vatAmount : 0)).toFixed(2))

  return {
    amount,
    currency: 'BDT' as const,
    taxSnapshot: {
      invoiceEnabled: registered,
      registrationStatus: registered ? 'registered' as const : 'not_registered' as const,
      operatorLegalName: tax?.operatorLegalName || '',
      binEncrypted: tax?.binEncrypted || '',
      vatRate,
      pricesIncludeVat,
      baseAmount: Number((registered && pricesIncludeVat ? baseAmount - vatAmount : baseAmount).toFixed(2)),
      vatAmount: Number(vatAmount.toFixed(2)),
    },
  }
}
