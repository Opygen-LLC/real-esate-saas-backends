import type { AreaUnit, ListingType, PropertyPricingMode } from './property'

export type AreaConversionSettings = { kathaSqft?: number; bighaKatha?: number }
export const areaFactors = (settings: AreaConversionSettings = {}): Record<AreaUnit, number> => {
  const katha = settings.kathaSqft ?? 720
  const bigha = settings.bighaKatha ?? 20
  if (!Number.isFinite(katha) || katha < 1 || katha > 10_000 || !Number.isFinite(bigha) || bigha < 1 || bigha > 100) throw new RangeError('Regional conversion settings are invalid')
  return { sqft: 1, decimal: 435.6, shotok: 435.6, acre: 43_560, katha, bigha: katha * bigha }
}
export const convertCatalogArea = (value: number, from: AreaUnit, to: AreaUnit, settings: AreaConversionSettings = {}): number => {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Area must be a non-negative number')
  const factors = areaFactors(settings)
  if (!factors[from] || !factors[to]) throw new RangeError('Unsupported area unit')
  return Number(((value * factors[from]) / factors[to]).toFixed(6))
}

/** Small declarative expression tree: one price rule, two execution targets (JS and MongoDB). */
type Expression =
  | { op: 'field'; path: string }
  | { op: 'literal'; value: string | number | boolean | null }
  | { op: 'positive'; value: Expression }
  | { op: 'hidden'; field: string }
  | { op: 'and'; values: Expression[] }
  | { op: 'not'; value: Expression }
  | { op: 'eq' | 'lt'; left: Expression; right: Expression }
  | { op: 'if'; when: Expression; yes: Expression; no: Expression }
const field = (path: string): Expression => ({ op: 'field', path })
const literal = (value: string | number | boolean | null): Expression => ({ op: 'literal', value })
const positive = (path: string): Expression => ({ op: 'positive', value: field(path) })
const hidden = (name: string): Expression => ({ op: 'hidden', field: name })
const not = (value: Expression): Expression => ({ op: 'not', value })
const and = (...values: Expression[]): Expression => ({ op: 'and', values })
const condition = (when: Expression, yes: Expression, no: Expression): Expression => ({ op: 'if', when, yes, no })
const discountRule = (publicView: boolean): Expression => and(
  { op: 'eq', left: field('isDiscount'), right: literal(true) },
  positive('price'), positive('discountedPrice'),
  { op: 'lt', left: field('discountedPrice'), right: field('price') },
  ...(publicView ? [not(hidden('price')), not(hidden('discount'))] : []),
)
export const effectivePriceRule = (publicView = true): Expression => condition(
  and(positive('price'), ...(publicView ? [not(hidden('price'))] : [])),
  condition(discountRule(publicView), field('discountedPrice'), field('price')),
  literal(null),
)
const readField = (source: unknown, path: string): unknown => path.split('.').reduce<unknown>((value, key) => (
  value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key) ? (value as Record<string, unknown>)[key] : undefined
), source)
const evaluate = (rule: Expression, source: unknown): unknown => {
  switch (rule.op) {
    case 'field': return readField(source, rule.path)
    case 'literal': return rule.value
    case 'hidden': { const list = readField(source, 'hiddenPublicFields'); return Array.isArray(list) && list.includes(rule.field) }
    case 'positive': { const value = evaluate(rule.value, source); return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER }
    case 'and': return rule.values.every((value) => Boolean(evaluate(value, source)))
    case 'not': return !evaluate(rule.value, source)
    case 'eq': return evaluate(rule.left, source) === evaluate(rule.right, source)
    case 'lt': return Number(evaluate(rule.left, source)) < Number(evaluate(rule.right, source))
    case 'if': return evaluate(evaluate(rule.when, source) ? rule.yes : rule.no, source)
  }
}
export const expressionToMongo = (rule: Expression): unknown => {
  switch (rule.op) {
    case 'field': return `$${rule.path}`
    case 'literal': return { $literal: rule.value }
    case 'hidden': return { $in: [rule.field, { $cond: [{ $isArray: '$hiddenPublicFields' }, '$hiddenPublicFields', []] }] }
    case 'positive': { const value = expressionToMongo(rule.value); return { $and: [{ $isNumber: value }, { $gt: [value, 0] }, { $lte: [value, Number.MAX_SAFE_INTEGER] }] } }
    case 'and': return { $and: rule.values.map(expressionToMongo) }
    case 'not': return { $not: [expressionToMongo(rule.value)] }
    case 'eq': return { $eq: [expressionToMongo(rule.left), expressionToMongo(rule.right)] }
    case 'lt': return { $lt: [expressionToMongo(rule.left), expressionToMongo(rule.right)] }
    case 'if': return { $cond: [expressionToMongo(rule.when), expressionToMongo(rule.yes), expressionToMongo(rule.no)] }
  }
}
export type PropertyPriceSource = {
  price?: number | null
  isDiscount?: boolean
  discountedPrice?: number | null
  hiddenPublicFields?: readonly string[]
  listingType?: ListingType | string
  pricing?: { mode?: PropertyPricingMode | string; unitRate?: number; askingPrice?: number }
}
export const effectivePropertyPrice = (property: PropertyPriceSource | null | undefined, publicView = true): number | null => evaluate(effectivePriceRule(publicView), property) as number | null
export const hasVisiblePropertyDiscount = (property: PropertyPriceSource | null | undefined): boolean => Boolean(evaluate(discountRule(true), property))
export const propertyPricePeriod = (property: PropertyPriceSource | null | undefined): 'month' | 'year' | null => {
  // Explicit annual pricing must win over the rental category.
  if (property?.pricing?.mode === 'YEARLY') return 'year'
  if (property?.pricing?.mode === 'MONTHLY' || property?.listingType === 'ForRent') return 'month'
  return null
}
export const formatPropertyMoney = (amount: number | null | undefined, options: { locale?: 'en' | 'bn'; compact?: boolean } = {}): string => {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return options.locale === 'bn' ? '\u09ae\u09c2\u09b2\u09cd\u09af \u099c\u09be\u09a8\u09a4\u09c7 \u09af\u09cb\u0997\u09be\u09af\u09cb\u0997 \u0995\u09b0\u09c1\u09a8' : 'Price on request'
  const locale = options.locale === 'bn' ? 'bn-BD' : 'en-BD'
  if (options.compact && amount >= 100_000) {
    const crore = amount >= 10_000_000
    const value = amount / (crore ? 10_000_000 : 100_000)
    const suffix = options.locale === 'bn' ? (crore ? '\u0995\u09cb\u099f\u09bf' : '\u09b2\u09be\u0996') : (crore ? 'Cr' : 'Lakh')
    return `\u09f3${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)} ${suffix}`
  }
  return `\u09f3${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount)}`
}
