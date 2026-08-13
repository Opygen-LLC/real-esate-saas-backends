import {
  divisions_en,
  districts_en,
  upazilas_en,
  unions_en,
} from 'bangladesh-location-data'
import { divisions_bn, districts_bn, upazilas_bn, unions_bn } from 'bangladesh-location-data/bangla'
import ApiError from '../../../errors/ApiError'

type Locale = 'en' | 'bn'
type Level = 'division' | 'district' | 'upazila' | 'area'
type LocationItem = { value: number; title: string }
type LocationMap = Record<string, LocationItem[]>

const data = {
  en: { division: divisions_en, district: districts_en, upazila: upazilas_en, area: unions_en },
  bn: { division: divisions_bn, district: districts_bn, upazila: upazilas_bn, area: unions_bn },
} as const

const getLocations = (level: Level, parentId?: string, locale: Locale = 'en', search = '') => {
  if (level !== 'division' && !parentId) throw new ApiError(400, 'parentId is required for this location level')
  const source = data[locale][level]
  const items = Array.isArray(source) ? source : (source as LocationMap)[String(parentId)] || []
  const translatedSource = data[locale === 'en' ? 'bn' : 'en'][level]
  const translatedItems = Array.isArray(translatedSource)
    ? translatedSource
    : (translatedSource as LocationMap)[String(parentId)] || []
  const query = search.trim().toLocaleLowerCase(locale === 'bn' ? 'bn-BD' : 'en-BD')

  return items
    .map((item, index) => ({
      id: String(item.value),
      name: item.title,
      alternateName: translatedItems[index]?.title || '',
      level,
      parentId: parentId || null,
    }))
    .filter(item => !query || `${item.name} ${item.alternateName}`.toLocaleLowerCase().includes(query))
}

export type AreaUnit = 'sqft' | 'decimal' | 'shotok' | 'katha' | 'bigha' | 'acre'
const defaultSqft: Record<AreaUnit, number> = {
  sqft: 1,
  decimal: 435.6,
  shotok: 435.6,
  katha: 720,
  bigha: 14400,
  acre: 43560,
}

const convertArea = (value: number, from: AreaUnit, to: AreaUnit, kathaSqft = 720, bighaKatha = 20) => {
  if (!Number.isFinite(value) || value < 0) throw new ApiError(400, 'Area must be a non-negative number')
  if (kathaSqft < 1 || bighaKatha < 1) throw new ApiError(400, 'Regional conversion settings are invalid')
  const factors = { ...defaultSqft, katha: kathaSqft, bigha: kathaSqft * bighaKatha }
  return {
    value: Number(((value * factors[from]) / factors[to]).toFixed(6)),
    from,
    to,
    conversion: { kathaSqft, bighaKatha, configurable: true },
  }
}

export const LocalizationService = { getLocations, convertArea }
