import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { convertAreaValue, type AreaConversionSettings, type AreaConversionUnit } from '../localization/areaConversion'
import {
  defaultPricingModeForProperty,
  isPricingModeAllowedForProperty,
  type ListingType,
  type PropertyPricingMode,
  type PropertyType,
} from './property.constants'
import type { IFinancingCalculator, IHotelInvestment, IProperty, IPropertyPaymentPlan, IPropertyPricing, IRentalTerms } from './property.interface'

const MAX_MONEY = 1_000_000_000_000
const AREA_MODE_UNIT: Partial<Record<PropertyPricingMode, AreaConversionUnit>> = {
  PER_SQFT: 'sqft',
  PER_KATHA: 'katha',
  PER_DECIMAL: 'decimal',
  PER_BIGHA: 'bigha',
  PER_ACRE: 'acre',
}

const finiteNonNegative = (value: unknown, label: string): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new ApiError(httpStatus.BAD_REQUEST, `${label} must be a non-negative number`)
  return parsed
}

const positiveMoney = (value: unknown, label: string): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_MONEY) throw new ApiError(httpStatus.BAD_REQUEST, `${label} must be greater than zero`)
  return parsed
}

const roundMoney = (value: number) => Number(value.toFixed(2))
const roundPercent = (value: number) => Number(value.toFixed(4))

export const calculateMonthlyEmi = (loanAmount: number, annualInterestPercent: number, loanTenureYears: number): number => {
  if (!(loanAmount > 0) || !(loanTenureYears > 0)) return 0
  const months = Math.max(1, Math.round(loanTenureYears * 12))
  const monthlyRate = Math.max(0, annualInterestPercent) / 100 / 12
  if (monthlyRate === 0) return roundMoney(loanAmount / months)
  const factor = (1 + monthlyRate) ** months
  return roundMoney(loanAmount * ((monthlyRate * factor) / (factor - 1)))
}

const normalizePricing = (
  payload: Partial<IProperty>,
  current: IProperty | undefined,
  propertyType: PropertyType,
  listingType: ListingType,
  conversion: AreaConversionSettings,
): IPropertyPricing => {
  const explicitPricing = payload.pricing
  const legacyPriceWasChanged = payload.price !== undefined && explicitPricing === undefined
  const source = explicitPricing || (legacyPriceWasChanged ? undefined : current?.pricing)
  const mode = (source?.mode || defaultPricingModeForProperty(propertyType, listingType)) as PropertyPricingMode
  if (!isPricingModeAllowedForProperty(propertyType, listingType, mode)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `${mode} pricing is not valid for ${propertyType} ${listingType}`)
  }

  const targetUnit = AREA_MODE_UNIT[mode]
  let askingPrice: number
  let unitRate: number | undefined
  if (targetUnit) {
    unitRate = positiveMoney(source?.unitRate, 'Unit rate')
    const area = finiteNonNegative(payload.area ?? current?.area, 'Area')
    const areaUnit = (payload.areaUnit ?? current?.areaUnit) as AreaConversionUnit | undefined
    if (!(area && areaUnit)) throw new ApiError(httpStatus.BAD_REQUEST, `Area and area unit are required for ${mode} pricing`)
    const pricedArea = convertAreaValue(area, areaUnit, targetUnit, conversion)
    if (!(pricedArea > 0)) throw new ApiError(httpStatus.BAD_REQUEST, 'Area must be greater than zero for unit pricing')
    askingPrice = positiveMoney(unitRate * pricedArea, 'Calculated asking price')
  } else {
    askingPrice = positiveMoney(source?.askingPrice ?? payload.price ?? current?.price, listingType === 'ForRent' ? 'Rent' : 'Asking price')
  }

  return {
    mode,
    ...(unitRate !== undefined ? { unitRate: roundMoney(unitRate) } : {}),
    askingPrice: roundMoney(askingPrice),
    negotiable: Boolean(source?.negotiable),
  }
}

const normalizeRentalTerms = (payload: Partial<IProperty>, current: IProperty | undefined, listingType: ListingType): IRentalTerms | undefined => {
  if (!['ForRent', 'ForLease'].includes(listingType)) return undefined
  const source = payload.rentalTerms ?? current?.rentalTerms
  if (!source) return undefined
  const advanceMonths = finiteNonNegative(source.advanceMonths, 'Advance months')
  const minimumLeaseMonths = finiteNonNegative(source.minimumLeaseMonths, 'Minimum lease period')
  if (advanceMonths !== undefined && !Number.isInteger(advanceMonths)) throw new ApiError(httpStatus.BAD_REQUEST, 'Advance months must be a whole number')
  if (minimumLeaseMonths !== undefined && !Number.isInteger(minimumLeaseMonths)) throw new ApiError(httpStatus.BAD_REQUEST, 'Minimum lease period must be a whole number')
  return {
    ...(finiteNonNegative(source.securityDeposit, 'Security deposit') !== undefined ? { securityDeposit: roundMoney(Number(source.securityDeposit)) } : {}),
    ...(advanceMonths !== undefined ? { advanceMonths } : {}),
    ...(minimumLeaseMonths !== undefined ? { minimumLeaseMonths } : {}),
    ...(source.availableFrom ? { availableFrom: new Date(source.availableFrom) } : {}),
    utilityIncluded: Boolean(source.utilityIncluded),
  }
}

const normalizePaymentPlan = (
  payload: Partial<IProperty>,
  current: IProperty | undefined,
  listingType: ListingType,
  askingPrice: number,
): IPropertyPaymentPlan | undefined => {
  if (listingType !== 'ForSale') return undefined
  const source = payload.paymentPlan ?? current?.paymentPlan
  if (!source) return undefined
  const type = source.type || 'FULL_PAYMENT'
  if (type === 'FULL_PAYMENT') return { type: 'FULL_PAYMENT', remainingAmount: 0 }

  const bookingAmount = finiteNonNegative(source.bookingAmount, 'Booking amount') || 0
  const handoverPayment = finiteNonNegative(source.handoverPayment, 'Handover payment') || 0
  const registrationPayment = finiteNonNegative(source.registrationPayment, 'Registration payment') || 0
  let downPaymentAmount = finiteNonNegative(source.downPaymentAmount, 'Down payment')
  let downPaymentPercent = finiteNonNegative(source.downPaymentPercent, 'Down payment percentage')
  if (downPaymentPercent !== undefined && downPaymentPercent > 100) throw new ApiError(httpStatus.BAD_REQUEST, 'Down payment percentage cannot exceed 100%')
  if (downPaymentPercent !== undefined) {
    const calculated = roundMoney(askingPrice * (downPaymentPercent / 100))
    if (downPaymentAmount !== undefined && Math.abs(calculated - downPaymentAmount) > 1) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Down payment amount does not match the supplied percentage')
    }
    downPaymentAmount = calculated
  } else if (downPaymentAmount !== undefined) {
    downPaymentPercent = askingPrice > 0 ? roundPercent((downPaymentAmount / askingPrice) * 100) : 0
  }
  downPaymentAmount ||= 0
  downPaymentPercent ||= 0

  const scheduledBeforeInstallments = bookingAmount + downPaymentAmount + handoverPayment + registrationPayment
  if (scheduledBeforeInstallments > askingPrice + 0.01) throw new ApiError(httpStatus.BAD_REQUEST, 'Payment plan amounts cannot exceed the property asking price')
  const remainingAmount = roundMoney(Math.max(0, askingPrice - scheduledBeforeInstallments))

  if (type === 'INSTALLMENT') {
    const installmentCount = finiteNonNegative(source.installmentCount, 'Installment count')
    if (!installmentCount || !Number.isInteger(installmentCount)) throw new ApiError(httpStatus.BAD_REQUEST, 'Installment count must be a positive whole number')
    if (!source.installmentFrequency) throw new ApiError(httpStatus.BAD_REQUEST, 'Installment frequency is required')
    return {
      type,
      bookingAmount: roundMoney(bookingAmount),
      downPaymentAmount: roundMoney(downPaymentAmount),
      downPaymentPercent: roundPercent(downPaymentPercent),
      installmentCount,
      installmentFrequency: source.installmentFrequency,
      handoverPayment: roundMoney(handoverPayment),
      registrationPayment: roundMoney(registrationPayment),
      remainingAmount,
      installmentAmount: roundMoney(remainingAmount / installmentCount),
    }
  }

  return {
    type: 'BANK_FINANCING',
    bookingAmount: roundMoney(bookingAmount),
    downPaymentAmount: roundMoney(downPaymentAmount),
    downPaymentPercent: roundPercent(downPaymentPercent),
    handoverPayment: roundMoney(handoverPayment),
    registrationPayment: roundMoney(registrationPayment),
    remainingAmount,
  }
}

const normalizeFinancingCalculator = (
  payload: Partial<IProperty>,
  current: IProperty | undefined,
  listingType: ListingType,
  askingPrice: number,
): IFinancingCalculator | undefined => {
  if (listingType !== 'ForSale') return undefined
  const source = payload.financingCalculator ?? current?.financingCalculator
  if (!source) return undefined
  if (!source.enabled) return { enabled: false, showPublic: false }

  const downPaymentPercent = finiteNonNegative(source.downPaymentPercent, 'Financing down payment percentage') ?? 0
  const interestRatePercent = finiteNonNegative(source.interestRatePercent, 'Interest rate') ?? 0
  const loanTenureYears = finiteNonNegative(source.loanTenureYears, 'Loan tenure')
  if (downPaymentPercent > 100) throw new ApiError(httpStatus.BAD_REQUEST, 'Financing down payment percentage cannot exceed 100%')
  if (interestRatePercent > 100) throw new ApiError(httpStatus.BAD_REQUEST, 'Interest rate cannot exceed 100%')
  if (!loanTenureYears || loanTenureYears > 50) throw new ApiError(httpStatus.BAD_REQUEST, 'Loan tenure must be between 1 and 50 years')
  const loanAmount = roundMoney(askingPrice * (1 - downPaymentPercent / 100))
  return {
    enabled: true,
    downPaymentPercent: roundPercent(downPaymentPercent),
    interestRatePercent: roundPercent(interestRatePercent),
    loanTenureYears,
    showPublic: Boolean(source.showPublic),
    loanAmount,
    estimatedMonthlyEmi: calculateMonthlyEmi(loanAmount, interestRatePercent, loanTenureYears),
  }
}

export const calculateHotelInvestment = (source: IHotelInvestment | undefined, askingPrice: number, totalRooms?: number): IHotelInvestment | undefined => {
  if (!source) return undefined
  const result: IHotelInvestment = { ...source, publicFields: [...new Set(source.publicFields || [])] }
  const annualRevenue = finiteNonNegative(source.annualRevenue, 'Annual revenue')
  const operatingExpenses = finiteNonNegative(source.operatingExpenses, 'Operating expenses')
  const explicitNoi = finiteNonNegative(source.netOperatingIncome, 'Net operating income')
  const noi = explicitNoi ?? (annualRevenue !== undefined && operatingExpenses !== undefined ? Math.max(0, annualRevenue - operatingExpenses) : undefined)

  if (source.averageOccupancyPercent !== undefined) {
    const occupancy = finiteNonNegative(source.averageOccupancyPercent, 'Average occupancy')!
    if (occupancy > 100) throw new ApiError(httpStatus.BAD_REQUEST, 'Average occupancy cannot exceed 100%')
    result.averageOccupancyPercent = roundPercent(occupancy)
  }
  for (const key of ['averageDailyRate', 'annualRevenue', 'operatingExpenses', 'netOperatingIncome', 'ebitda'] as const) {
    const value = finiteNonNegative(source[key], key)
    if (value !== undefined) result[key] = roundMoney(value)
  }
  if (noi !== undefined && result.netOperatingIncome === undefined) result.netOperatingIncome = roundMoney(noi)
  if (totalRooms && totalRooms > 0) result.pricePerRoom = roundMoney(askingPrice / totalRooms)
  if (annualRevenue !== undefined && askingPrice > 0) result.grossYieldPercent = roundPercent((annualRevenue / askingPrice) * 100)
  if (annualRevenue !== undefined && operatingExpenses !== undefined && askingPrice > 0) result.netYieldPercent = roundPercent((Math.max(0, annualRevenue - operatingExpenses) / askingPrice) * 100)
  if (noi !== undefined && askingPrice > 0) result.capRatePercent = roundPercent((noi / askingPrice) * 100)
  return result
}

export const normalizePropertyFinancials = async (
  organizationId: string,
  payload: Partial<IProperty>,
  current: IProperty | undefined,
  conversion: AreaConversionSettings,
): Promise<Partial<IProperty>> => {
  void organizationId
  const propertyType = (payload.propertyType || current?.propertyType) as PropertyType
  const listingType = (payload.listingType || current?.listingType) as ListingType
  const pricing = normalizePricing(payload, current, propertyType, listingType, conversion)
  const next: Partial<IProperty> = {
    ...payload,
    price: pricing.askingPrice,
    pricing,
  }

  const rentalTerms = normalizeRentalTerms(payload, current, listingType)
  const paymentPlan = normalizePaymentPlan(payload, current, listingType, pricing.askingPrice)
  const financingCalculator = normalizeFinancingCalculator(payload, current, listingType, pricing.askingPrice)
  const hotelInvestment = propertyType === 'HotelResort'
    ? calculateHotelInvestment(payload.hotelInvestment ?? current?.hotelInvestment, pricing.askingPrice, Number(payload.totalRooms ?? current?.totalRooms ?? 0) || undefined)
    : undefined

  if (rentalTerms) next.rentalTerms = rentalTerms
  if (paymentPlan) next.paymentPlan = paymentPlan
  if (financingCalculator) next.financingCalculator = financingCalculator
  if (hotelInvestment) next.hotelInvestment = hotelInvestment
  return next
}

export const propertyFinancialFieldsToUnset = (propertyType: PropertyType, listingType: ListingType): string[] => {
  const fields: string[] = []
  if (!['ForRent', 'ForLease'].includes(listingType)) fields.push('rentalTerms')
  if (listingType !== 'ForSale') fields.push('paymentPlan', 'financingCalculator')
  if (propertyType !== 'HotelResort') fields.push('hotelInvestment')
  return fields
}
