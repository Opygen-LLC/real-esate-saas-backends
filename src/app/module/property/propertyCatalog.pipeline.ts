import type { PipelineStage } from 'mongoose'
import type { IPropertyFilter } from './property.interface'
import { AREA_UNITS, type AreaUnit } from '../../../contracts/websiteCatalog/property'
import { areaFactors, effectivePriceRule, expressionToMongo, convertCatalogArea, type AreaConversionSettings } from '../../../contracts/websiteCatalog/values'
import ApiError from '../../../errors/ApiError'

const present = (value: unknown) => value !== undefined && value !== null && value !== ''
const nonNegative = (value: unknown, label: string): number | undefined => {
  if (!present(value)) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new ApiError(400, `${label} must be a non-negative number`)
  return parsed
}
const hiddenFields = { $cond: [{ $isArray: '$hiddenPublicFields' }, '$hiddenPublicFields', []] }
const positive = (path: string) => ({ $and: [{ $isNumber: `$${path}` }, { $gt: [`$${path}`, 0] }, { $lte: [`$${path}`, Number.MAX_SAFE_INTEGER] }] })

/** An explicit area unit is required; unknown legacy units are not guessed as square feet. */
export const catalogAreaExpression = (conversion: AreaConversionSettings, publicView: boolean, landOnly = false): Record<string, unknown> => {
  const factors = areaFactors(conversion)
  const area = (field: string, unit: string) => ({ $cond: [positive(field), {
    $switch: { branches: Object.entries(factors).map(([key, multiplier]) => ({ case: { $eq: [`$${unit}`, key] }, then: { $multiply: [`$${field}`, multiplier] } })), default: null },
  }, null] })
  const value = landOnly ? area('landArea', 'landAreaUnit') : {
    $cond: [positive('area'), area('area', 'areaUnit'), { $cond: [{ $eq: ['$propertyType', 'HotelResort'] }, area('landArea', 'landAreaUnit'), null] }],
  }
  return publicView ? { $cond: [{ $in: ['area', hiddenFields] }, null, value] } : value
}

export type CatalogPlanInput = {
  baseWhere: Record<string, unknown>
  filters: IPropertyFilter
  sortBy: string
  sortOrder: 'asc' | 'desc'
  skip: number
  limit: number
  cursorRange?: Record<string, unknown>
  publicView?: boolean
  conversion?: AreaConversionSettings
}
export const requiresCatalogComputation = (filters: IPropertyFilter, sortBy: string) =>
  ['price', 'area'].includes(sortBy) || ['minPrice', 'maxPrice', 'minArea', 'maxArea', 'minLandArea', 'maxLandArea'].some((key) => present(filters[key as keyof IPropertyFilter]))

/** All computed filters and the stable _id sort run on MongoDB BEFORE skip/limit. No materialized value to go stale. */
export const buildCatalogPlan = ({ baseWhere, filters, sortBy, sortOrder, skip, limit, cursorRange, publicView = false, conversion = {} }: CatalogPlanInput) => {
  const match: Record<string, unknown> = {}
  const additions: Record<string, unknown> = {}
  const priceNeeded = sortBy === 'price' || present(filters.minPrice) || present(filters.maxPrice)
  const areaNeeded = sortBy === 'area' || present(filters.minArea) || present(filters.maxArea)
  const landNeeded = present(filters.minLandArea) || present(filters.maxLandArea)
  if (priceNeeded) additions.__catalogPrice = expressionToMongo(effectivePriceRule(publicView))
  if (areaNeeded) additions.__catalogArea = catalogAreaExpression(conversion, publicView)
  if (landNeeded) additions.__catalogLandArea = catalogAreaExpression(conversion, publicView, true)
  const range = (minInput: unknown, maxInput: unknown, field: string, areaUnit?: string) => {
    let min = nonNegative(minInput, 'Minimum value'); let max = nonNegative(maxInput, 'Maximum value')
    if (min === undefined && max === undefined) return
    if (min !== undefined && max !== undefined && min > max) throw new ApiError(400, 'Maximum value must be greater than or equal to minimum value')
    if (areaUnit !== undefined) {
      if (!AREA_UNITS.includes(areaUnit as AreaUnit)) throw new ApiError(400, 'Unsupported area unit')
      if (min !== undefined) min = convertCatalogArea(min, areaUnit as AreaUnit, 'sqft', conversion)
      if (max !== undefined) max = convertCatalogArea(max, areaUnit as AreaUnit, 'sqft', conversion)
    }
    match[field] = { $ne: null, ...(min !== undefined ? { $gte: min } : {}), ...(max !== undefined ? { $lte: max } : {}) }
  }
  range(filters.minPrice, filters.maxPrice, '__catalogPrice')
  range(filters.minArea, filters.maxArea, '__catalogArea', filters.areaUnit || 'sqft')
  range(filters.minLandArea, filters.maxLandArea, '__catalogLandArea', filters.landAreaUnit || 'sqft')
  const common: PipelineStage[] = [{ $match: baseWhere }]
  if (Object.keys(additions).length) common.push({ $set: additions })
  if (Object.keys(match).length) common.push({ $match: match })
  const direction = sortOrder === 'asc' ? 1 : -1
  const field = sortBy === 'price' ? '__catalogPrice' : sortBy === 'area' ? '__catalogArea' : sortBy
  const data: PipelineStage[] = [...common]
  if (cursorRange) data.push({ $match: cursorRange })
  // Unknown and hidden prices/areas always sort last, in either direction.
  if (field.startsWith('__catalog')) data.push({ $set: { __catalogMissing: { $cond: [{ $eq: [`$${field}`, null] }, 1, 0] } } })
  data.push({ $sort: { ...(field.startsWith('__catalog') ? { __catalogMissing: 1 as const } : {}), [field]: direction, _id: direction } })
  if (skip) data.push({ $skip: skip })
  data.push({ $limit: limit }, { $unset: ['__catalogPrice', '__catalogArea', '__catalogLandArea', '__catalogMissing'] })
  const count: PipelineStage[] = [...common, { $count: 'total' }]
  return { data, count }
}
