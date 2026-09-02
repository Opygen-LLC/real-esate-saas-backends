import {
  divisions_en,
  districts_en,
  upazilas_en,
  unions_en,
} from 'bangladesh-location-data'
import { divisions_bn, districts_bn, upazilas_bn, unions_bn } from 'bangladesh-location-data/bangla'
import ApiError from '../../../errors/ApiError'
import { areaSummary, convertArea, type AreaConversionUnit } from './areaConversion'

type Locale = 'en' | 'bn'
type Level = 'division' | 'district' | 'upazila' | 'area'
type LocationItem = { value: number; title: string }
type LocationMap = Record<string, LocationItem[]>

const data = {
  en: { division: divisions_en, district: districts_en, upazila: upazilas_en, area: unions_en },
  bn: { division: divisions_bn, district: districts_bn, upazila: upazilas_bn, area: unions_bn },
} as const

const getLevelItems = (source: LocationItem[] | LocationMap, parentId?: string): LocationItem[] => {
  if (Array.isArray(source)) return source
  return source[String(parentId)] || []
}

const getLocations = (level: Level, parentId?: string, locale: Locale = 'en', search = '') => {
  if (level !== 'division' && !parentId) throw new ApiError(400, 'parentId is required for this location level')

  const items = getLevelItems(data[locale][level] as LocationItem[] | LocationMap, parentId)
  const translatedItems = getLevelItems(
    data[locale === 'en' ? 'bn' : 'en'][level] as LocationItem[] | LocationMap,
    parentId,
  )
  // Never pair translations by array position: package ordering can differ between
  // English and Bangla datasets. The numeric location value is the stable key.
  const translatedById = new Map(translatedItems.map((item) => [String(item.value), item.title]))
  const query = search.trim().toLocaleLowerCase(locale === 'bn' ? 'bn-BD' : 'en-BD')

  return items
    .map((item) => ({
      id: String(item.value),
      name: item.title,
      alternateName: translatedById.get(String(item.value)) || '',
      level,
      parentId: parentId || null,
    }))
    .filter((item) => !query || `${item.name} ${item.alternateName}`.toLocaleLowerCase().includes(query))
}

export type AreaUnit = AreaConversionUnit

export const LocalizationService = {
  getLocations,
  convertArea: (value: number, from: AreaUnit, to: AreaUnit, kathaSqft = 720, bighaKatha = 20) => convertArea(value, from, to, { kathaSqft, bighaKatha }),
  areaSummary: (value: number, from: AreaUnit, kathaSqft = 720, bighaKatha = 20) => areaSummary(value, from, { kathaSqft, bighaKatha }),
}
