import {
  APPROVAL_AUTHORITIES, AREA_UNITS, HOTEL_OPERATING_STATUSES, LISTING_TYPES,
  PROPERTY_FACINGS, PROPERTY_PRICING_MODES, PROPERTY_TYPES, PUBLIC_PROPERTY_STATUSES,
  type AreaUnit, type ListingType, type PropertyType, type PropertyPricingMode,
} from './property'

export const CATALOG_CONTRACT_VERSION = 1 as const
export const PUBLIC_CATALOG_SORT_FIELDS = ['createdAt', 'updatedAt', 'price', 'area', 'title'] as const
export const PUBLIC_CATALOG_DEFAULTS = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' } as const
export const PUBLIC_CATALOG_MAX_LIMIT = 100
export const PUBLIC_CATALOG_MAX_PAGE = 10_000
export const PUBLIC_QUERY_ALIASES = { type: 'propertyType', location: 'city', q: 'searchTerm' } as const
export type ContractIssue = { path: string; message: string }
export type CatalogSortField = typeof PUBLIC_CATALOG_SORT_FIELDS[number]

export const PUBLIC_QUERY_NUMERIC_FIELDS = [
  'minPrice', 'maxPrice', 'bedrooms', 'bathrooms', 'minArea', 'maxArea', 'minFloor', 'maxFloor',
  'minUnitRate', 'maxUnitRate', 'minRoadWidthFeet', 'minRooms', 'starRating', 'minLandArea',
  'maxLandArea', 'minSecurityDeposit',
] as const
export const PUBLIC_QUERY_TEXT_FIELDS = ['searchTerm', 'city', 'state', 'divisionId', 'districtId', 'upazilaId', 'agentId'] as const
const ENUM_FIELDS = {
  propertyType: PROPERTY_TYPES, listingType: LISTING_TYPES, status: PUBLIC_PROPERTY_STATUSES,
  areaUnit: AREA_UNITS, landAreaUnit: AREA_UNITS, pricingMode: PROPERTY_PRICING_MODES,
  facing: PROPERTY_FACINGS, approvalAuthority: APPROVAL_AUTHORITIES,
  hotelOperatingStatus: HOTEL_OPERATING_STATUSES,
} as const
export const PUBLIC_QUERY_FILTER_KEYS = [
  ...PUBLIC_QUERY_TEXT_FIELDS, ...Object.keys(ENUM_FIELDS), ...PUBLIC_QUERY_NUMERIC_FIELDS,
  'availableBy', 'furnished', 'isFeatured',
] as readonly string[]
export const PUBLIC_QUERY_KEYS = [...PUBLIC_QUERY_FILTER_KEYS, 'sortBy', 'sortOrder', 'page', 'limit', 'cursor'] as readonly string[]

type NumericField = typeof PUBLIC_QUERY_NUMERIC_FIELDS[number]
type TextField = typeof PUBLIC_QUERY_TEXT_FIELDS[number]
export type PublicPropertyQuery = Partial<Record<NumericField, number>> & Partial<Record<TextField, string>> & {
  propertyType?: PropertyType
  listingType?: ListingType
  status?: typeof PUBLIC_PROPERTY_STATUSES[number]
  areaUnit?: AreaUnit
  landAreaUnit?: AreaUnit
  pricingMode?: PropertyPricingMode
  facing?: typeof PROPERTY_FACINGS[number]
  approvalAuthority?: typeof APPROVAL_AUTHORITIES[number]
  hotelOperatingStatus?: typeof HOTEL_OPERATING_STATUSES[number]
  availableBy?: string
  furnished?: boolean
  isFeatured?: boolean
  sortBy: CatalogSortField
  sortOrder: 'asc' | 'desc'
  page: number
  limit: number
  cursor?: string
}
export type PublicPropertyQueryInput = Record<string, unknown>
type SearchParamsLike = { forEach: (callback: (value: string, key: string) => void) => void }

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const objectInput = (input: PublicPropertyQueryInput | SearchParamsLike): PublicPropertyQueryInput => {
  if (typeof input?.forEach !== 'function') return isPlainObject(input) ? input as PublicPropertyQueryInput : {}
  const result: PublicPropertyQueryInput = Object.create(null)
  ;(input as SearchParamsLike).forEach((value, key) => {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      const previous = result[key]
      result[key] = Array.isArray(previous) ? [...previous, value] : [previous, value]
    } else result[key] = value
  })
  return result
}

const PURPOSE_ALIASES: Readonly<Record<string, ListingType>> = {
  sale: 'ForSale', 'for-sale': 'ForSale', buy: 'ForSale', rent: 'ForRent', rental: 'ForRent',
  'for-rent': 'ForRent', lease: 'ForLease', 'for-lease': 'ForLease',
}
// Old homepage selectors included types the database has never supported.
// Preserve the search intent as text instead of inventing a new property type.
const LEGACY_TYPE_SEARCH: Readonly<Record<string, string>> = { penthouse: 'Penthouse', duplex: 'Duplex' }

/** The same validator is used by the API, homepage links, URL state and client requests. */
export const parsePublicPropertyQuery = (input: PublicPropertyQueryInput | SearchParamsLike) => {
  const source = { ...objectInput(input) }
  for (const [alias, canonical] of Object.entries(PUBLIC_QUERY_ALIASES)) {
    if (source[canonical] === undefined && source[alias] !== undefined) source[canonical] = source[alias]
  }
  const query: PublicPropertyQuery = { ...PUBLIC_CATALOG_DEFAULTS }
  const result = query as Record<string, unknown>
  const issues: ContractIssue[] = []
  const issue = (path: string, message: string) => issues.push({ path, message })
  const scalar = (key: string): string | undefined => {
    const value = source[key]
    if (value === undefined || value === null || value === '') return undefined
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      issue(key, `${key} must have one scalar value`)
      return undefined
    }
    const trimmed = String(value).trim()
    return trimmed || undefined
  }
  for (const key of PUBLIC_QUERY_TEXT_FIELDS) {
    const value = scalar(key)
    if (value === undefined) continue
    const maximum = key === 'searchTerm' ? 120 : 100
    if (value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) issue(key, `${key} must contain at most ${maximum} printable characters`)
    else if (key === 'agentId' && !/^[a-f\d]{24}$/i.test(value)) issue(key, 'agentId must be a valid property agent identifier')
    else result[key] = value
  }
  for (const [key, values] of Object.entries(ENUM_FIELDS)) {
    const value = scalar(key)
    if (value === undefined || value.toLowerCase() === 'all') continue
    let normalized = values.find((item) => item.toLowerCase() === value.toLowerCase())
    if (key === 'propertyType' && value.toLowerCase() === 'plot') normalized = 'LandPlot'
    if (key === 'listingType') normalized ||= PURPOSE_ALIASES[value.toLowerCase()]
    if (key === 'propertyType' && LEGACY_TYPE_SEARCH[value.toLowerCase()]) {
      query.searchTerm = [query.searchTerm, LEGACY_TYPE_SEARCH[value.toLowerCase()]].filter(Boolean).join(' ')
      if (query.searchTerm.length > 120) issue('searchTerm', 'Combined legacy search exceeds 120 characters')
      continue
    }
    if (!normalized) issue(key, `Unsupported ${key}`)
    else result[key] = normalized
  }
  if (query.searchTerm && query.searchTerm.split(/\s+/).filter(Boolean).length > 12) issue('searchTerm', 'Use at most 12 search words')
  for (const key of PUBLIC_QUERY_NUMERIC_FIELDS) {
    const value = scalar(key)
    if (value === undefined) continue
    const number = Number(value)
    const wholeNumber = ['bedrooms', 'bathrooms', 'minFloor', 'maxFloor', 'minRooms', 'starRating'].includes(key)
    if (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(number) || number > 1_000_000_000_000 || (wholeNumber && !Number.isInteger(number))) {
      issue(key, `${key} must be a finite, non-negative ${wholeNumber ? 'integer' : 'number'}`)
    } else if (key === 'starRating' && number > 5) issue(key, 'starRating cannot exceed 5')
    else result[key] = number
  }
  for (const [min, max] of [['minPrice', 'maxPrice'], ['minArea', 'maxArea'], ['minFloor', 'maxFloor'], ['minUnitRate', 'maxUnitRate'], ['minLandArea', 'maxLandArea']] as const) {
    if (query[min] !== undefined && query[max] !== undefined && query[min]! > query[max]!) issue(max, `${max} must be greater than or equal to ${min}`)
  }
  for (const key of ['furnished', 'isFeatured'] as const) {
    const value = scalar(key)
    if (value === undefined) continue
    if (value === 'true' || value === 'false') query[key] = value === 'true'
    else issue(key, `${key} must be true or false`)
  }
  for (const [key, maximum] of [['page', PUBLIC_CATALOG_MAX_PAGE], ['limit', PUBLIC_CATALOG_MAX_LIMIT]] as const) {
    const value = scalar(key)
    if (value === undefined) continue
    const number = Number(value)
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > maximum) issue(key, `${key} must be an integer between 1 and ${maximum}`)
    else query[key] = number
  }
  const sortBy = scalar('sortBy')
  if (sortBy && PUBLIC_CATALOG_SORT_FIELDS.includes(sortBy as CatalogSortField)) query.sortBy = sortBy as CatalogSortField
  else if (sortBy === 'effectivePrice') query.sortBy = 'price'
  else if (sortBy) issue('sortBy', 'Unsupported public catalog sort field')
  const sortOrder = scalar('sortOrder')
  if (sortOrder === 'asc' || sortOrder === 'desc') query.sortOrder = sortOrder
  else if (sortOrder) issue('sortOrder', 'sortOrder must be asc or desc')
  const cursor = scalar('cursor')
  if (cursor && cursor.length <= 1024) query.cursor = cursor
  else if (cursor) issue('cursor', 'Pagination cursor is too long')
  if (cursor && (query.sortBy !== 'createdAt' || query.sortOrder !== 'desc' || query.page !== 1)) issue('cursor', 'Cursor pagination requires page=1, sortBy=createdAt and sortOrder=desc')
  const availableBy = scalar('availableBy')
  if (availableBy) {
    const date = new Date(`${availableBy}T00:00:00.000Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(availableBy) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== availableBy) issue('availableBy', 'availableBy must be a valid YYYY-MM-DD date')
    else query.availableBy = availableBy
  }
  return { query, issues }
}

/** Stable encoding eliminates aliases and never drops numeric zero or false. */
export const serializePublicPropertyQuery = (input: PublicPropertyQuery, omitDefaults = true): string => {
  const params = new URLSearchParams()
  const values = input as Record<string, unknown>
  for (const key of PUBLIC_QUERY_KEYS) {
    const value = values[key]
    if (value === undefined || value === null || value === '') continue
    if (omitDefaults && key in PUBLIC_CATALOG_DEFAULTS && value === PUBLIC_CATALOG_DEFAULTS[key as keyof typeof PUBLIC_CATALOG_DEFAULTS]) continue
    params.set(key, String(value))
  }
  return params.toString()
}

export const publicPropertySearchHref = (input: PublicPropertyQueryInput, path = '/properties'): string => {
  const { query, issues } = parsePublicPropertyQuery(input)
  if (issues.length) throw new Error(issues.map((item) => item.message).join('; '))
  const search = serializePublicPropertyQuery(query)
  return `${path}${search ? `?${search}` : ''}`
}
