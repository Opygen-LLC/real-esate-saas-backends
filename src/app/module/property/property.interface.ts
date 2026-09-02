import mongoose, { Model } from 'mongoose'
import type { ApprovalAuthority, AreaUnit, HotelInvestmentField, HotelOperatingStatus, HotelType, InstallmentFrequency, LandOwnershipType, LandRoadType, ListingType, MutationStatus, PropertyDocumentType, PropertyFacing, PropertyMediaProvider, PropertyMediaType, PropertyPaymentType, PropertyPricingMode, PropertyStatus, PropertyType, PublicPropertyField } from './property.constants'

export type IPropertyTypeEnum = PropertyType
export type IListingType = ListingType
export type IPropertyStatus = PropertyStatus
export type IAreaUnit = AreaUnit
export type IPropertyMediaProvider = PropertyMediaProvider
export type IPropertyMediaType = PropertyMediaType

export interface IBangladeshAddress {
  divisionId?: string; division?: string; districtId?: string; district?: string
  upazilaId?: string; upazila?: string; areaId?: string; area?: string
  road?: string; block?: string; sector?: string; mouza?: string; postalCode?: string; landmark?: string
}

export interface IUtilityStatus { electricity?: boolean; gas?: boolean; water?: boolean; sewerage?: boolean; internet?: boolean }
export interface IRegulatoryDetails {
  approvalAuthority?: ApprovalAuthority
  approvalNumber?: string; mutationStatus?: MutationStatus
  khatianNumber?: string; holdingTaxPaidThrough?: string
}

export interface IPropertyPricing {
  mode: PropertyPricingMode
  unitRate?: number
  askingPrice: number
  negotiable?: boolean
}

export interface IRentalTerms {
  securityDeposit?: number
  advanceMonths?: number
  minimumLeaseMonths?: number
  availableFrom?: Date
  utilityIncluded?: boolean
}

export interface IPropertyPaymentPlan {
  type: PropertyPaymentType
  bookingAmount?: number
  downPaymentAmount?: number
  downPaymentPercent?: number
  installmentCount?: number
  installmentFrequency?: InstallmentFrequency
  handoverPayment?: number
  registrationPayment?: number
  remainingAmount?: number
  installmentAmount?: number
}

export interface IFinancingCalculator {
  enabled?: boolean
  downPaymentPercent?: number
  interestRatePercent?: number
  loanTenureYears?: number
  showPublic?: boolean
  loanAmount?: number
  estimatedMonthlyEmi?: number
}

export interface IHotelInvestment {
  averageOccupancyPercent?: number
  averageDailyRate?: number
  annualRevenue?: number
  operatingExpenses?: number
  netOperatingIncome?: number
  ebitda?: number
  publicFields?: HotelInvestmentField[]
  pricePerRoom?: number
  grossYieldPercent?: number
  netYieldPercent?: number
  capRatePercent?: number
}

export interface IPropertyDocument {
  assetId: mongoose.Types.ObjectId | string
  category: PropertyDocumentType
  originalName: string
  mimeType: string
  size: number
  visibility?: 'private'
}

export interface IPropertyImage {
  _id?: mongoose.Types.ObjectId | string
  assetId?: mongoose.Types.ObjectId | string
  url: string
  publicId?: string
  caption?: string
  isFeatured?: boolean
  order?: number
}


export interface IPropertyMediaLink {
  id: string
  url: string
  provider: IPropertyMediaProvider
  type: IPropertyMediaType
  title?: string
  isHero?: boolean
  embedUrl?: string
}

export interface IProperty {
  organizationId: string
  title: string
  slug: string
  description?: string
  propertyType: IPropertyTypeEnum
  listingType: IListingType
  status: IPropertyStatus
  price: number
  pricing?: IPropertyPricing
  rentalTerms?: IRentalTerms
  paymentPlan?: IPropertyPaymentPlan
  financingCalculator?: IFinancingCalculator
  hotelInvestment?: IHotelInvestment
  documents?: IPropertyDocument[]
  isDiscount?: boolean
  discountedPrice?: number
  currency: 'BDT'
  bedrooms?: number
  bathrooms?: number
  balconies?: number
  area?: number
  areaUnit?: IAreaUnit
  floorNumber?: number
  totalFloors?: number
  yearBuilt?: number
  parking?: number
  furnished?: boolean
  address?: string
  city?: string
  state?: string
  divisionId?: string
  districtId?: string
  upazilaId?: string
  country?: string
  bangladeshAddress?: IBangladeshAddress
  facing?: PropertyFacing
  roadWidthFeet?: number
  roadType?: LandRoadType
  roadFrontageFeet?: number
  cornerPlot?: boolean
  plotNumber?: string
  dagNumber?: string
  ownershipType?: LandOwnershipType
  landShare?: string
  utilities?: IUtilityStatus
  regulatory?: IRegulatoryDetails
  developerName?: string
  buildingName?: string
  liftAvailable?: boolean
  generatorAvailable?: boolean
  handoverDate?: Date
  serviceCharge?: number
  loadingAccess?: string
  hotelName?: string
  hotelType?: HotelType
  starRating?: number
  hotelOperatingStatus?: HotelOperatingStatus
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
  latitude?: number
  longitude?: number
  mapUrl?: string
  images: IPropertyImage[]
  mediaLinks?: IPropertyMediaLink[]
  amenities: string[]
  features?: string[]
  hiddenPublicFields?: PublicPropertyField[]
  agentId?: mongoose.Types.ObjectId | string
  ownerId?: mongoose.Types.ObjectId | string
  publishedAt?: Date | null
  views: number
  isFeatured?: boolean
  quotaLocked?: boolean
  quotaLockedReason?: 'subscription_limit' | 'tenant_admin' | null
  quotaLockedAt?: Date | null
  quotaLockedBy?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export type IPropertyFilter = {
  searchTerm?: string
  organizationId?: string
  propertyType?: string
  listingType?: string
  status?: string | string[]
  city?: string
  state?: string
  divisionId?: string
  districtId?: string
  upazilaId?: string
  minPrice?: number | string
  maxPrice?: number | string
  bedrooms?: number | string
  bathrooms?: number | string
  minArea?: number | string
  maxArea?: number | string
  areaUnit?: string
  minFloor?: number | string
  maxFloor?: number | string
  pricingMode?: string
  minUnitRate?: number | string
  maxUnitRate?: number | string
  minRoadWidthFeet?: number | string
  facing?: string
  approvalAuthority?: string
  minRooms?: number | string
  starRating?: number | string
  hotelOperatingStatus?: string
  minLandArea?: number | string
  maxLandArea?: number | string
  landAreaUnit?: string
  minSecurityDeposit?: number | string
  availableBy?: string
  furnished?: boolean | string
  isFeatured?: boolean | string
  agentId?: string
  quotaLocked?: boolean | string
}

export type PropertyModel = Model<IProperty>
