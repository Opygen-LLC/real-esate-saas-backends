export const PROPERTY_TYPES = [
  'Apartment',
  'LandPlot',
  'Commercial',
  'Office',
  'Shop',
  'Warehouse',
  'ReadyFlat',
  'UnderConstruction',
  'HotelResort',
  'RentalSublet',
] as const

export const LISTING_TYPES = ['ForSale', 'ForRent', 'ForLease'] as const
export const PROPERTY_PRICING_MODES = ['TOTAL', 'PER_SQFT', 'PER_KATHA', 'PER_DECIMAL', 'PER_BIGHA', 'PER_ACRE', 'MONTHLY', 'YEARLY'] as const
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
export const LAND_ROAD_TYPES = ['Paved', 'Asphalt', 'Concrete', 'Brick', 'Unpaved', 'Other'] as const
export const LAND_OWNERSHIP_TYPES = ['SingleOwner', 'MultipleOwners', 'Freehold', 'Leasehold'] as const
export const HOTEL_TYPES = ['Hotel', 'Resort', 'BoutiqueHotel', 'BusinessHotel', 'BeachResort', 'EcoResort', 'LuxuryResort', 'GuestHouse'] as const
export const HOTEL_OPERATING_STATUSES = ['Operational', 'UnderRenovation', 'TemporarilyClosed', 'UnderConstruction', 'NonOperational'] as const
export const PROPERTY_PAYMENT_TYPES = ['FULL_PAYMENT', 'INSTALLMENT', 'BANK_FINANCING'] as const
export const INSTALLMENT_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL', 'CUSTOM'] as const
export const HOTEL_FACILITIES = [
  'Restaurant', 'Swimming Pool', 'Conference Hall', 'Banquet Hall', 'Spa', 'Gym', 'Rooftop', 'Bar', 'Garden', 'Kids Zone',
  'Private Beach', 'Parking', 'Generator', 'Lift', 'Wi-Fi', 'CCTV', '24/7 Security', 'Room Service', 'Laundry', 'Business Center',
] as const
export const HOTEL_INVESTMENT_FIELDS = [
  'averageOccupancyPercent', 'averageDailyRate', 'annualRevenue', 'operatingExpenses', 'netOperatingIncome', 'ebitda',
  'pricePerRoom', 'grossYieldPercent', 'netYieldPercent', 'capRatePercent',
] as const
export const PROPERTY_DOCUMENT_TYPES = [
  'Deed', 'Mutation', 'Khatian', 'TaxReceipt', 'Survey', 'MouzaMap', 'Approval', 'PowerOfAttorney',
  'TradeLicense', 'FireCertificate', 'EnvironmentalCertificate', 'HotelLicense', 'FinancialStatements',
] as const
export const PROPERTY_DOCUMENT_TYPES_BY_PROPERTY = {
  LandPlot: ['Deed', 'Mutation', 'Khatian', 'TaxReceipt', 'Survey', 'MouzaMap', 'Approval', 'PowerOfAttorney'],
  HotelResort: ['TradeLicense', 'FireCertificate', 'EnvironmentalCertificate', 'HotelLicense', 'FinancialStatements'],
} as const

export const PUBLIC_PROPERTY_FIELDS = [
  'price',
  'discount',
  'description',
  'address',
  'location',
  'map',
  'bedrooms',
  'bathrooms',
  'floor',
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
export type PropertyPricingMode = (typeof PROPERTY_PRICING_MODES)[number]
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
export type LandRoadType = (typeof LAND_ROAD_TYPES)[number]
export type LandOwnershipType = (typeof LAND_OWNERSHIP_TYPES)[number]
export type HotelType = (typeof HOTEL_TYPES)[number]
export type HotelOperatingStatus = (typeof HOTEL_OPERATING_STATUSES)[number]
export type PropertyPaymentType = (typeof PROPERTY_PAYMENT_TYPES)[number]
export type InstallmentFrequency = (typeof INSTALLMENT_FREQUENCIES)[number]
export type HotelInvestmentField = (typeof HOTEL_INVESTMENT_FIELDS)[number]
export type PropertyDocumentType = (typeof PROPERTY_DOCUMENT_TYPES)[number]

/**
 * Canonical property-spec contract shared conceptually with the frontend.
 * Any field in this list is automatically removed when the selected property
 * type does not allow it, both during create and type-changing updates.
 */
export const PROPERTY_SPEC_FIELDS = [
  'bedrooms',
  'bathrooms',
  'balconies',
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
  'roadType',
  'roadFrontageFeet',
  'cornerPlot',
  'plotNumber',
  'dagNumber',
  'ownershipType',
  'landShare',
  'utilities',
  'regulatory',
  'developerName',
  'buildingName',
  'liftAvailable',
  'generatorAvailable',
  'handoverDate',
  'serviceCharge',
  'loadingAccess',
  'hotelName',
  'hotelType',
  'starRating',
  'hotelOperatingStatus',
  'yearEstablished',
  'lastRenovationYear',
  'totalRooms',
  'operationalRooms',
  'suites',
  'villas',
  'cottages',
  'totalBeds',
  'landArea',
  'landAreaUnit',
  'builtUpArea',
  'builtUpAreaUnit',
] as const

export type PropertySpecField = (typeof PROPERTY_SPEC_FIELDS)[number]

export type PropertyTypeConfig = {
  fields: readonly PropertySpecField[]
  requiredFields: readonly PropertySpecField[]
  areaUnits: readonly AreaUnit[]
  listingTypes: readonly ListingType[]
  pricingModes: readonly PropertyPricingMode[]
  wizardSteps: readonly [string, string, string, string, string, string]
}

/**
 * The canonical policy for every supported property type. Extend this object
 * when adding future Building/Industrial types instead of scattering new
 * propertyType conditionals through controllers and UI code.
 */
export const PROPERTY_TYPE_CONFIG: Readonly<Record<PropertyType, PropertyTypeConfig>> = {
  Apartment: {
    fields: ['bedrooms', 'bathrooms', 'balconies', 'area', 'areaUnit', 'floorNumber', 'totalFloors', 'yearBuilt', 'parking', 'furnished', 'amenities', 'facing', 'landShare', 'utilities', 'developerName', 'buildingName', 'liftAvailable', 'generatorAvailable', 'serviceCharge'],
    requiredFields: [],
    areaUnits: ['sqft'],
    listingTypes: ['ForSale', 'ForRent'],
    pricingModes: ['TOTAL', 'PER_SQFT', 'MONTHLY'],
    wizardSteps: ['Basic Information', 'Location', 'Photos & Media', 'Apartment Details', 'Pricing & Payment', 'Review'],
  },
  ReadyFlat: {
    fields: ['bedrooms', 'bathrooms', 'balconies', 'area', 'areaUnit', 'floorNumber', 'totalFloors', 'yearBuilt', 'parking', 'furnished', 'amenities', 'facing', 'landShare', 'utilities', 'developerName', 'buildingName', 'liftAvailable', 'generatorAvailable', 'serviceCharge'],
    requiredFields: [],
    areaUnits: ['sqft'],
    listingTypes: ['ForSale', 'ForRent'],
    pricingModes: ['TOTAL', 'PER_SQFT', 'MONTHLY'],
    wizardSteps: ['Basic Information', 'Location', 'Photos & Media', 'Ready Flat Details', 'Pricing & Payment', 'Review'],
  },
  UnderConstruction: {
    fields: ['bedrooms', 'bathrooms', 'balconies', 'area', 'areaUnit', 'floorNumber', 'totalFloors', 'parking', 'amenities', 'facing', 'landShare', 'utilities', 'regulatory', 'developerName', 'buildingName', 'liftAvailable', 'generatorAvailable', 'handoverDate', 'serviceCharge'],
    requiredFields: [],
    areaUnits: ['sqft'],
    listingTypes: ['ForSale'],
    pricingModes: ['TOTAL', 'PER_SQFT'],
    wizardSteps: ['Project Information', 'Location', 'Photos & Media', 'Construction Details', 'Pricing & Payment', 'Review'],
  },
  LandPlot: {
    fields: ['area', 'areaUnit', 'facing', 'roadWidthFeet', 'roadType', 'roadFrontageFeet', 'cornerPlot', 'plotNumber', 'dagNumber', 'ownershipType', 'utilities', 'regulatory'],
    requiredFields: [],
    areaUnits: ['decimal', 'shotok', 'katha', 'bigha', 'acre', 'sqft'],
    listingTypes: ['ForSale', 'ForLease'],
    pricingModes: ['TOTAL', 'PER_KATHA', 'PER_SQFT', 'PER_DECIMAL', 'PER_BIGHA', 'PER_ACRE'],
    wizardSteps: ['Land Information', 'Location', 'Photos & Documents', 'Land & Ownership', 'Pricing', 'Review'],
  },
  Commercial: {
    fields: ['bathrooms', 'area', 'areaUnit', 'floorNumber', 'totalFloors', 'yearBuilt', 'parking', 'furnished', 'amenities', 'facing', 'roadWidthFeet', 'utilities', 'regulatory', 'buildingName', 'liftAvailable', 'generatorAvailable', 'serviceCharge', 'loadingAccess'],
    requiredFields: [],
    areaUnits: ['sqft'],
    listingTypes: ['ForSale', 'ForRent', 'ForLease'],
    pricingModes: ['TOTAL', 'PER_SQFT', 'MONTHLY', 'YEARLY'],
    wizardSteps: ['Basic Information', 'Location', 'Photos & Media', 'Commercial Details', 'Pricing', 'Review'],
  },
  Office: {
    fields: ['bathrooms', 'area', 'areaUnit', 'floorNumber', 'totalFloors', 'yearBuilt', 'parking', 'furnished', 'amenities', 'facing', 'utilities', 'buildingName', 'liftAvailable', 'generatorAvailable', 'serviceCharge'],
    requiredFields: [],
    areaUnits: ['sqft'],
    listingTypes: ['ForSale', 'ForRent', 'ForLease'],
    pricingModes: ['TOTAL', 'PER_SQFT', 'MONTHLY', 'YEARLY'],
    wizardSteps: ['Basic Information', 'Location', 'Photos & Media', 'Office Details', 'Pricing', 'Review'],
  },
  Shop: {
    fields: ['bathrooms', 'area', 'areaUnit', 'floorNumber', 'totalFloors', 'yearBuilt', 'parking', 'furnished', 'roadWidthFeet', 'utilities', 'buildingName', 'generatorAvailable', 'serviceCharge'],
    requiredFields: [],
    areaUnits: ['sqft'],
    listingTypes: ['ForSale', 'ForRent', 'ForLease'],
    pricingModes: ['TOTAL', 'PER_SQFT', 'MONTHLY', 'YEARLY'],
    wizardSteps: ['Basic Information', 'Location', 'Photos & Media', 'Shop Details', 'Pricing', 'Review'],
  },
  Warehouse: {
    fields: ['bathrooms', 'area', 'areaUnit', 'yearBuilt', 'parking', 'roadWidthFeet', 'roadType', 'utilities', 'generatorAvailable', 'loadingAccess'],
    requiredFields: [],
    areaUnits: ['sqft'],
    listingTypes: ['ForSale', 'ForRent', 'ForLease'],
    pricingModes: ['TOTAL', 'PER_SQFT', 'MONTHLY', 'YEARLY'],
    wizardSteps: ['Basic Information', 'Location', 'Photos & Media', 'Warehouse Details', 'Pricing', 'Review'],
  },
  HotelResort: {
    fields: ['parking', 'amenities', 'facing', 'roadWidthFeet', 'utilities', 'hotelName', 'hotelType', 'starRating', 'hotelOperatingStatus', 'yearEstablished', 'lastRenovationYear', 'totalRooms', 'operationalRooms', 'suites', 'villas', 'cottages', 'totalBeds', 'landArea', 'landAreaUnit', 'builtUpArea', 'builtUpAreaUnit'],
    requiredFields: [],
    areaUnits: ['sqft'],
    listingTypes: ['ForSale', 'ForLease'],
    pricingModes: ['TOTAL'],
    wizardSteps: ['Hotel Information', 'Location', 'Photos & Media', 'Hotel Operations', 'Investment & Pricing', 'Review'],
  },
  RentalSublet: {
    fields: ['bedrooms', 'bathrooms', 'balconies', 'area', 'areaUnit', 'floorNumber', 'totalFloors', 'parking', 'furnished', 'amenities', 'facing', 'utilities', 'buildingName', 'liftAvailable', 'generatorAvailable', 'serviceCharge'],
    requiredFields: [],
    areaUnits: ['sqft'],
    listingTypes: ['ForRent', 'ForLease'],
    pricingModes: ['MONTHLY', 'YEARLY'],
    wizardSteps: ['Basic Information', 'Location', 'Photos & Media', 'Rental Details', 'Pricing', 'Review'],
  },
}

// Backwards-compatible alias used by existing property modules.
export const PROPERTY_TYPE_FIELDS = PROPERTY_TYPE_CONFIG

export const propertyTypeSupports = (propertyType: PropertyType, field: PropertySpecField) =>
  PROPERTY_TYPE_CONFIG[propertyType].fields.includes(field)

export const defaultAreaUnitForPropertyType = (propertyType: PropertyType): AreaUnit =>
  PROPERTY_TYPE_CONFIG[propertyType].areaUnits[0] || 'sqft'

export const allowedListingTypesForPropertyType = (propertyType: PropertyType): readonly ListingType[] =>
  PROPERTY_TYPE_CONFIG[propertyType].listingTypes

export const defaultListingTypeForPropertyType = (propertyType: PropertyType): ListingType =>
  PROPERTY_TYPE_CONFIG[propertyType].listingTypes[0]

export const isListingTypeAllowedForPropertyType = (propertyType: PropertyType, listingType: ListingType): boolean =>
  PROPERTY_TYPE_CONFIG[propertyType].listingTypes.includes(listingType)

const SALE_PRICING_MODES = new Set<PropertyPricingMode>(['TOTAL', 'PER_SQFT', 'PER_KATHA', 'PER_DECIMAL', 'PER_BIGHA', 'PER_ACRE'])
const RENT_PRICING_MODES = new Set<PropertyPricingMode>(['MONTHLY', 'PER_SQFT'])
const LEASE_PRICING_MODES = new Set<PropertyPricingMode>(['YEARLY', 'MONTHLY', 'TOTAL', 'PER_SQFT', 'PER_KATHA', 'PER_DECIMAL', 'PER_BIGHA', 'PER_ACRE'])

export const allowedPricingModesForProperty = (propertyType: PropertyType, listingType: ListingType): readonly PropertyPricingMode[] => {
  const allowedByListing = listingType === 'ForSale' ? SALE_PRICING_MODES : listingType === 'ForRent' ? RENT_PRICING_MODES : LEASE_PRICING_MODES
  return PROPERTY_TYPE_CONFIG[propertyType].pricingModes.filter((mode) => allowedByListing.has(mode))
}

export const defaultPricingModeForProperty = (propertyType: PropertyType, listingType: ListingType): PropertyPricingMode => {
  const allowed = allowedPricingModesForProperty(propertyType, listingType)
  if (listingType === 'ForRent' && allowed.includes('MONTHLY')) return 'MONTHLY'
  if (listingType === 'ForLease' && allowed.includes('YEARLY')) return 'YEARLY'
  return allowed[0] || 'TOTAL'
}

export const isPricingModeAllowedForProperty = (propertyType: PropertyType, listingType: ListingType, mode: PropertyPricingMode): boolean =>
  allowedPricingModesForProperty(propertyType, listingType).includes(mode)

export const allowedDocumentTypesForProperty = (propertyType: PropertyType): readonly PropertyDocumentType[] =>
  propertyType === 'LandPlot' ? PROPERTY_DOCUMENT_TYPES_BY_PROPERTY.LandPlot : propertyType === 'HotelResort' ? PROPERTY_DOCUMENT_TYPES_BY_PROPERTY.HotelResort : []

