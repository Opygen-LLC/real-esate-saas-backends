import ApiError from '../../../errors/ApiError'

import { AREA_UNITS } from '../../../contracts/websiteCatalog/property'
export const AREA_CONVERSION_UNITS = AREA_UNITS
export type AreaConversionUnit = (typeof AREA_CONVERSION_UNITS)[number]

import { convertCatalogArea } from '../../../contracts/websiteCatalog/values'
import type { AreaConversionSettings } from '../../../contracts/websiteCatalog/values'
export type { AreaConversionSettings } from '../../../contracts/websiteCatalog/values'
export const convertAreaValue = (value: number, from: AreaConversionUnit, to: AreaConversionUnit, settings: AreaConversionSettings = {}) => {
  try { return convertCatalogArea(value, from, to, settings) }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Invalid area conversion') }
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
