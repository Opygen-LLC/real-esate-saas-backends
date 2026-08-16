import { IBangladeshAddress, IProperty } from './property.interface'

const BANGLA_DIGITS: Record<string, string> = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
}

export const normalizeBangladeshDigits = (value: string): string =>
  value.replace(/[০-৯]/g, digit => BANGLA_DIGITS[digit] || digit)

export const normalizePostalCode = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeBangladeshDigits(value).trim()
  return normalized || undefined
}

type LegacyPropertyPayload = Partial<IProperty> & { zipCode?: string }

export const normalizePropertyPostalCode = (payload: LegacyPropertyPayload): Partial<IProperty> => {
  const legacyPostalCode = normalizePostalCode(payload.zipCode)
  const nestedPostalCode = normalizePostalCode(payload.bangladeshAddress?.postalCode)
  const postalCode = nestedPostalCode || legacyPostalCode
  const { zipCode: _legacyZipCode, ...rest } = payload

  if (!postalCode && !payload.bangladeshAddress) return rest

  const bangladeshAddress: IBangladeshAddress = {
    ...(payload.bangladeshAddress || {}),
    ...(postalCode ? { postalCode } : {}),
  }
  return { ...rest, bangladeshAddress }
}
