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
export const PUBLIC_PROPERTY_STATUSES = ['Available', 'UnderOffer'] as const
export const VIEWING_REQUESTABLE_PROPERTY_STATUSES = ['Available', 'UnderOffer'] as const
export const CRM_PROPERTY_INTEREST_STATUSES = ['Available', 'UnderOffer', 'Reserved', 'ComingSoon'] as const
export const PROPERTY_CURRENCIES = ['BDT'] as const
export const PROPERTY_COUNTRIES = ['Bangladesh'] as const
export const AREA_UNITS = ['sqft', 'decimal', 'shotok', 'katha', 'bigha', 'acre'] as const
export const PROPERTY_FACINGS = ['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'] as const
export const APPROVAL_AUTHORITIES = ['none', 'RAJUK', 'CDA', 'RDA', 'KDA', 'other'] as const
export const MUTATION_STATUSES = ['not_applicable', 'pending', 'completed'] as const
export const PROPERTY_MEDIA_PROVIDERS = ['youtube', 'vimeo', 'matterport', 'kuula', 'other'] as const
export const PROPERTY_MEDIA_TYPES = ['video', 'virtual_tour', '360'] as const

export const PUBLIC_PROPERTY_FIELDS = [
  'price',
  'discount',
  'description',
  'address',
  'location',
  'map',
  'bedrooms',
  'bathrooms',
  'area',
  'landShare',
  'yearBuilt',
  'parking',
  'furnished',
  'serviceCharge',
  'developer',
  'handover',
  'utilities',
  'regulatory',
  'amenities',
  'features',
  'agent',
  'facing',
  'roadWidth',
] as const

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
export type PublicPropertyField = (typeof PUBLIC_PROPERTY_FIELDS)[number]

/**
 * Canonical property-spec contract shared conceptually with the frontend.
 * These are the fields whose persistence is dependent on propertyType.
 */
export const PROPERTY_SPEC_FIELDS = [
  'bedrooms',
  'bathrooms',
  'area',
  'areaUnit',
  'floorNumber',
  'totalFloors',
  'yearBuilt',
  'parking',
  'furnished',
  'amenities',
  'facing',
  'roadWidthFeet',
  'landShare',
  'utilities',
  'regulatory',
  'developerName',
  'handoverDate',
  'serviceCharge',
  'loadingAccess',
] as const

export type PropertySpecField = (typeof PROPERTY_SPEC_FIELDS)[number]

type PropertyTypeFieldConfig = {
  fields: readonly PropertySpecField[]
  areaUnits: readonly AreaUnit[]
}

export const PROPERTY_TYPE_FIELDS: Readonly<Record<PropertyType, PropertyTypeFieldConfig>> = {
  Apartment: {
    fields: ['bedrooms', 'bathrooms', 'area', 'areaUnit', 'floorNumber', 'totalFloors', 'yearBuilt', 'parking', 'furnished', 'amenities', 'facing', 'landShare', 'utilities', 'serviceCharge'],
    areaUnits: ['sqft'],
  },
  ReadyFlat: {
    fields: ['bedrooms', 'bathrooms', 'area', 'areaUnit', 'floorNumber', 'totalFloors', 'yearBuilt', 'parking', 'furnished', 'amenities', 'facing', 'landShare', 'utilities', 'serviceCharge'],
    areaUnits: ['sqft'],
  },
  UnderConstruction: {
    fields: ['bedrooms', 'bathrooms', 'area', 'areaUnit', 'floorNumber', 'totalFloors', 'parking', 'amenities', 'facing', 'landShare', 'utilities', 'regulatory', 'developerName', 'handoverDate', 'serviceCharge'],
    areaUnits: ['sqft'],
  },
  LandPlot: {
    fields: ['area', 'areaUnit', 'facing', 'roadWidthFeet', 'utilities', 'regulatory'],
    areaUnits: ['decimal', 'shotok', 'katha', 'bigha', 'acre', 'sqft'],
  },
  Commercial: {
    fields: ['bathrooms', 'area', 'areaUnit', 'floorNumber', 'totalFloors', 'yearBuilt', 'parking', 'furnished', 'amenities', 'facing', 'roadWidthFeet', 'utilities', 'regulatory', 'serviceCharge', 'loadingAccess'],
    areaUnits: ['sqft'],
  },
  Office: {
    fields: ['bathrooms', 'area', 'areaUnit', 'floorNumber', 'totalFloors', 'yearBuilt', 'parking', 'furnished', 'amenities', 'facing', 'utilities', 'serviceCharge'],
    areaUnits: ['sqft'],
  },
  Shop: {
    fields: ['bathrooms', 'area', 'areaUnit', 'floorNumber', 'totalFloors', 'yearBuilt', 'parking', 'furnished', 'roadWidthFeet', 'utilities', 'serviceCharge'],
    areaUnits: ['sqft'],
  },
  Warehouse: {
    fields: ['bathrooms', 'area', 'areaUnit', 'yearBuilt', 'parking', 'roadWidthFeet', 'utilities', 'loadingAccess'],
    areaUnits: ['sqft'],
  },
  RentalSublet: {
    fields: ['bedrooms', 'bathrooms', 'area', 'areaUnit', 'floorNumber', 'totalFloors', 'parking', 'furnished', 'amenities', 'facing', 'utilities', 'serviceCharge'],
    areaUnits: ['sqft'],
  },
}

export const propertyTypeSupports = (propertyType: PropertyType, field: PropertySpecField) =>
  PROPERTY_TYPE_FIELDS[propertyType].fields.includes(field)

export const defaultAreaUnitForPropertyType = (propertyType: PropertyType): AreaUnit =>
  PROPERTY_TYPE_FIELDS[propertyType].areaUnits[0] || 'sqft'
