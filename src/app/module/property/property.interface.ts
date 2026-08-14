import mongoose, { Model } from 'mongoose'

export type IPropertyTypeEnum = 'Apartment' | 'LandPlot' | 'Commercial' | 'Office' | 'Shop' |
  'Warehouse' | 'ReadyFlat' | 'UnderConstruction' | 'RentalSublet'

export type IListingType = 'ForSale' | 'ForRent' | 'ForLease'

export type IPropertyStatus =
  | 'Draft'
  | 'Available'
  | 'Reserved'
  | 'UnderOffer'
  | 'Sold'
  | 'Rented'
  | 'OffMarket'
  | 'ComingSoon'

export type IAreaUnit = 'sqft' | 'decimal' | 'shotok' | 'katha' | 'bigha' | 'acre'
export type IModerationStatus = 'pending' | 'approved' | 'rejected' | 'flagged'

export interface IBangladeshAddress {
  divisionId?: string; division?: string; districtId?: string; district?: string
  upazilaId?: string; upazila?: string; areaId?: string; area?: string
  road?: string; block?: string; sector?: string; mouza?: string; postalCode?: string; landmark?: string
}

export interface IUtilityStatus { electricity?: boolean; gas?: boolean; water?: boolean; sewerage?: boolean; internet?: boolean }
export interface IRegulatoryDetails {
  approvalAuthority?: 'none' | 'RAJUK' | 'CDA' | 'RDA' | 'KDA' | 'other'
  approvalNumber?: string; mutationStatus?: 'not_applicable' | 'pending' | 'completed'
  khatianNumber?: string; holdingTaxPaidThrough?: string
}

export interface IPropertyImage {
  url: string
  publicId?: string
  caption?: string
  isFeatured?: boolean
  order?: number
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
  currency: 'BDT'
  bedrooms?: number
  bathrooms?: number
  area?: number
  areaUnit: IAreaUnit
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
  zipCode?: string
  bangladeshAddress?: IBangladeshAddress
  facing?: 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest'
  roadWidthFeet?: number
  landShare?: string
  utilities?: IUtilityStatus
  regulatory?: IRegulatoryDetails
  developerName?: string
  handoverDate?: Date
  serviceCharge?: number
  latitude?: number
  longitude?: number
  mapUrl?: string
  images: IPropertyImage[]
  videos?: string[]
  amenities: string[]
  features?: string[]
  agentId?: mongoose.Types.ObjectId | string
  ownerId?: mongoose.Types.ObjectId | string
  publishedAt?: Date
  views: number
  isFeatured?: boolean
  moderationStatus: IModerationStatus
  moderationReason?: string
  moderatedBy?: string
  moderatedAt?: Date
  createdAt?: Date
  updatedAt?: Date
}

export type IPropertyFilter = {
  searchTerm?: string
  organizationId?: string
  propertyType?: string
  listingType?: string
  status?: string
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
  furnished?: boolean | string
  isFeatured?: boolean | string
  agentId?: string
  moderationStatus?: IModerationStatus
}

export type PropertyModel = Model<IProperty>
