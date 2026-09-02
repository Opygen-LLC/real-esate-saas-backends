import ApiError from '../../../errors/ApiError'

export const AREA_CONVERSION_UNITS = ['sqft', 'decimal', 'shotok', 'katha', 'bigha', 'acre'] as const
export type AreaConversionUnit = (typeof AREA_CONVERSION_UNITS)[number]

const BASE_SQFT_FACTORS: Readonly<Record<Exclude<AreaConversionUnit, 'katha' | 'bigha'>, number>> = {
  sqft: 1,
  decimal: 435.6,
  shotok: 435.6,
  acre: 43560,
}

export type AreaConversionSettings = { kathaSqft?: number; bighaKatha?: number }

const factorsFor = (settings: AreaConversionSettings = {}): Record<AreaConversionUnit, number> => {
  const kathaSqft = Number(settings.kathaSqft ?? 720)
  const bighaKatha = Number(settings.bighaKatha ?? 20)
  if (!Number.isFinite(kathaSqft) || kathaSqft < 1 || !Number.isFinite(bighaKatha) || bighaKatha < 1) {
    throw new ApiError(400, 'Regional conversion settings are invalid')
  }
  return {
    ...BASE_SQFT_FACTORS,
    katha: kathaSqft,
    bigha: kathaSqft * bighaKatha,
  }
}

export const convertAreaValue = (
  value: number,
  from: AreaConversionUnit,
  to: AreaConversionUnit,
  settings: AreaConversionSettings = {},
) => {
  if (!Number.isFinite(value) || value < 0) throw new ApiError(400, 'Area must be a non-negative number')
  const factors = factorsFor(settings)
  return Number(((value * factors[from]) / factors[to]).toFixed(6))
}

export const convertArea = (
  value: number,
  from: AreaConversionUnit,
  to: AreaConversionUnit,
  settings: AreaConversionSettings = {},
) => ({
  value: convertAreaValue(value, from, to, settings),
  from,
  to,
  conversion: {
    kathaSqft: Number(settings.kathaSqft ?? 720),
    bighaKatha: Number(settings.bighaKatha ?? 20),
    configurable: true,
  },
})

export const areaSummary = (
  value: number,
  from: AreaConversionUnit,
  settings: AreaConversionSettings = {},
) => ({
  input: { value, unit: from },
  values: Object.fromEntries(AREA_CONVERSION_UNITS.map((unit) => [unit, convertAreaValue(value, from, unit, settings)])) as Record<AreaConversionUnit, number>,
  conversion: {
    kathaSqft: Number(settings.kathaSqft ?? 720),
    bighaKatha: Number(settings.bighaKatha ?? 20),
    configurable: true,
  },
})
