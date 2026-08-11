import mongoose, { Model } from 'mongoose'

export type IPropertyTypeEnum =
  | 'Apartment'
  | 'House'
  | 'Villa'
  | 'Condo'
  | 'Townhouse'
  | 'Land'
  | 'Commercial'
  | 'Office'
  | 'Shop'
  | 'Warehouse'
  | 'Industrial'
  | 'Development'
  | string

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

export type IAreaUnit = 'sqft' | 'sqm' | 'marla' | 'decimal' | 'acre'

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
  currency: string
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
  country?: string
  zipCode?: string
  latitude?: number
  longitude?: number
  images: IPropertyImage[]
  videos?: string[]
  amenities: string[]
  features?: string[]
  agentId?: mongoose.Types.ObjectId | string
  ownerId?: mongoose.Types.ObjectId | string
  publishedAt?: Date
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
