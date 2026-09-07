import type { AreaUnit, ListingType, PropertyType, PropertyPricingMode, PublicPropertyField } from './property'
import type { PublicPropertyQuery } from './query'

/** Wire DTO, never a database model or Partial<IProperty>. Private records are not extensible here. */
export type PublicPropertyDto = {
  _id: string
  organizationId: string
  title: string
  slug?: string
  propertyType: PropertyType
  listingType: ListingType
  status: string
  publishedAt?: string
  isFeatured?: boolean
  createdAt?: string
  updatedAt?: string
  images?: Array<{ _id?: string; url: string; caption?: string; alt?: string; isFeatured?: boolean; order?: number; assetId?: string }>
  mediaLinks?: Array<{ id?: string; url: string; provider?: string; type?: string; title?: string; isHero?: boolean; embedUrl?: string }>
  description?: string
  price?: number
  currency?: 'BDT'
  isDiscount?: boolean
  discountedPrice?: number
  effectivePrice: number | null
  priceStatus: 'available' | 'on_request'
  pricePeriod: 'month' | 'year' | null
  pricing?: { mode: PropertyPricingMode; unitRate?: number; askingPrice?: number; negotiable?: boolean }
  rentalTerms?: { securityDeposit?: number; advanceMonths?: number; minimumLeaseMonths?: number; availableFrom?: string; utilityIncluded?: boolean }
  paymentPlan?: { type?: string; bookingAmount?: number; downPaymentAmount?: number; downPaymentPercent?: number; installmentCount?: number; installmentFrequency?: string; installmentAmount?: number; handoverPayment?: number; registrationPayment?: number; remainingAmount?: number }
  financingCalculator?: { enabled: boolean; downPaymentPercent?: number; interestRatePercent?: number; loanTenureYears?: number; loanAmount?: number; estimatedMonthlyEmi?: number; showPublic: boolean }
  city?: string
  state?: string
  country?: string
  address?: string
  bangladeshAddress?: { divisionId?: string; division?: string; districtId?: string; district?: string; upazilaId?: string; upazila?: string; areaId?: string; area?: string; road?: string; block?: string; sector?: string; mouza?: string; postalCode?: string; landmark?: string }
  latitude?: number
  longitude?: number
  mapUrl?: string
  bedrooms?: number
  bathrooms?: number
  floorNumber?: number
  yearBuilt?: number
  parking?: number
  furnished?: boolean
  landShare?: string | number
  serviceCharge?: number
  developerName?: string
  handoverDate?: string
  facing?: string
  roadWidthFeet?: number
  area?: number
  areaUnit?: AreaUnit
  hotelName?: string
  hotelType?: string
  starRating?: number
  hotelOperatingStatus?: string
  yearEstablished?: number
  lastRenovationYear?: number
  totalRooms?: number
  operationalRooms?: number
  suites?: number
  villas?: number
  cottages?: number
  totalBeds?: number
  landArea?: number
  landAreaUnit?: AreaUnit
  builtUpArea?: number
  builtUpAreaUnit?: AreaUnit
  hotelInvestment?: Record<string, number>
  utilities?: { electricity?: boolean; gas?: boolean; water?: boolean; sewerage?: boolean; internet?: boolean }
  regulatory?: { approvalAuthority?: string; approvalNumber?: string; mutationStatus?: string; khatianNumber?: string; holdingTaxPaidThrough?: string }
  amenities?: string[]
  features?: string[]
  agentId?: { _id?: string; name?: string; email?: string; phoneNumber?: string; profileImgURL?: string; licenseNumber?: string; bio?: string; userRole?: string }
}
export type PublicPropertyPageMeta = {
  page: number
  limit: number
  total: number
  hasMore: boolean
  nextCursor?: string
  paginationMode: 'page' | 'cursor'
  contractVersion?: number
}
export type PublicPropertyPageResponse = { data: PublicPropertyDto[]; meta: PublicPropertyPageMeta }
export type PublicPropertyDetailResponse = { data: { property: PublicPropertyDto; similarProperties: PublicPropertyDto[] } }
export type PublicPropertyRequest = Partial<PublicPropertyQuery> & { organizationId: string }

/** Public filters must not reveal hidden values through membership or sort ordering. */
export const PUBLIC_FILTER_VISIBILITY: Readonly<Partial<Record<keyof PublicPropertyQuery, PublicPropertyField>>> = {
  city: 'location', state: 'location', divisionId: 'location', districtId: 'location', upazilaId: 'location',
  agentId: 'agent', bedrooms: 'bedrooms', bathrooms: 'bathrooms', minFloor: 'floor', maxFloor: 'floor',
  minRoadWidthFeet: 'roadWidth', facing: 'facing', approvalAuthority: 'regulatory', furnished: 'furnished',
  pricingMode: 'price', minUnitRate: 'price', maxUnitRate: 'price', minSecurityDeposit: 'price', availableBy: 'price',
}

/** A bounded, ordered selection read used for Studio-curated references. */
export const parsePublicPropertySelection = (input: unknown): string[] => {
  if (typeof input !== 'string' || input.length > 650) throw new Error('Provide a comma-separated list of at most 25 property identifiers')
  if (input === '') return []
  const ids = input.split(',').map((id) => id.trim().toLowerCase())
  if (ids.length > 25 || ids.some((id) => !/^[a-f\d]{24}$/i.test(id)) || new Set(ids).size !== ids.length) throw new Error('Provide unique property identifiers (maximum 25)')
  return ids
}
