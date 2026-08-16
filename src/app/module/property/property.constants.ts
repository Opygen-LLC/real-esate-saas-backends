export const PROPERTY_TYPES = [
  'Apartment',
  'LandPlot',
  'Commercial',
  'Office',
  'Shop',
  'Warehouse',
  'ReadyFlat',
  'UnderConstruction',
  'RentalSublet',
] as const

export const LISTING_TYPES = ['ForSale', 'ForRent', 'ForLease'] as const
export const PROPERTY_STATUSES = ['Draft', 'Available', 'Reserved', 'UnderOffer', 'Sold', 'Rented', 'OffMarket', 'ComingSoon'] as const
export const PROPERTY_CURRENCIES = ['BDT'] as const
export const PROPERTY_COUNTRIES = ['Bangladesh'] as const
export const AREA_UNITS = ['sqft', 'decimal', 'shotok', 'katha', 'bigha', 'acre'] as const
export const PROPERTY_FACINGS = ['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'] as const
export const APPROVAL_AUTHORITIES = ['none', 'RAJUK', 'CDA', 'RDA', 'KDA', 'other'] as const
export const MUTATION_STATUSES = ['not_applicable', 'pending', 'completed'] as const
export const PROPERTY_MEDIA_PROVIDERS = ['youtube', 'vimeo', 'matterport', 'kuula', 'other'] as const
export const PROPERTY_MEDIA_TYPES = ['video', 'virtual_tour', '360'] as const

export type PropertyType = (typeof PROPERTY_TYPES)[number]
export type ListingType = (typeof LISTING_TYPES)[number]
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number]
export type PropertyCurrency = (typeof PROPERTY_CURRENCIES)[number]
export type PropertyCountry = (typeof PROPERTY_COUNTRIES)[number]
export type AreaUnit = (typeof AREA_UNITS)[number]
export type PropertyFacing = (typeof PROPERTY_FACINGS)[number]
export type ApprovalAuthority = (typeof APPROVAL_AUTHORITIES)[number]
export type MutationStatus = (typeof MUTATION_STATUSES)[number]
export type PropertyMediaProvider = (typeof PROPERTY_MEDIA_PROVIDERS)[number]
export type PropertyMediaType = (typeof PROPERTY_MEDIA_TYPES)[number]
