import mongoose, { Model } from 'mongoose'
import type { PropertyStatus } from './property.constants'

export type IPropertyTypeEnum = 'Apartment' | 'LandPlot' | 'Commercial' | 'Office' | 'Shop' |
  'Warehouse' | 'ReadyFlat' | 'UnderConstruction' | 'RentalSublet'

export type IListingType = 'ForSale' | 'ForRent' | 'ForLease'

export type IPropertyStatus = PropertyStatus

export type IAreaUnit = 'sqft' | 'decimal' | 'shotok' | 'katha' | 'bigha' | 'acre'
export type IPropertyMediaProvider = 'youtube' | 'vimeo' | 'matterport' | 'kuula' | 'other'
export type IPropertyMediaType = 'video' | 'virtual_tour' | '360'

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
  mediaLinks?: IPropertyMediaLink[]
  amenities: string[]
  features?: string[]
  agentId?: mongoose.Types.ObjectId | string
  ownerId?: mongoose.Types.ObjectId | string
  publishedAt?: Date | null
  views: number
  isFeatured?: boolean
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
}

export type PropertyModel = Model<IProperty>
