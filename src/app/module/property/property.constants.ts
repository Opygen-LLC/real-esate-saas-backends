export const PROPERTY_STATUSES = [
  'Draft',
  'Available',
  'Reserved',
  'UnderOffer',
  'Sold',
  'Rented',
  'OffMarket',
  'ComingSoon',
] as const

export type PropertyStatus = (typeof PROPERTY_STATUSES)[number]
