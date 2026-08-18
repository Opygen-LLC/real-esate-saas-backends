import { Schema, model } from 'mongoose'
import { IProperty, PropertyModel } from './property.interface'
import { AREA_UNITS, APPROVAL_AUTHORITIES, LISTING_TYPES, MUTATION_STATUSES, PROPERTY_COUNTRIES, PROPERTY_CURRENCIES, PROPERTY_FACINGS, PROPERTY_MEDIA_PROVIDERS, PROPERTY_MEDIA_TYPES, PROPERTY_STATUSES, PROPERTY_TYPES } from './property.constants'

const propertyMediaLinkSchema = new Schema(
  {
    id: { type: String, required: true, trim: true, maxlength: 80 },
    url: { type: String, required: true, trim: true, maxlength: 2048 },
    provider: { type: String, enum: PROPERTY_MEDIA_PROVIDERS, required: true },
    type: { type: String, enum: PROPERTY_MEDIA_TYPES, required: true },
    title: { type: String, default: '', maxlength: 160 },
    isHero: { type: Boolean, default: false },
    embedUrl: { type: String, default: '', trim: true, maxlength: 2048 },
  },
  { _id: false },
)

const propertyImageSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, default: '' },
    caption: { type: String, default: '' },
    isFeatured: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: true }
)

const propertySchema = new Schema<IProperty, PropertyModel>(
  {
    organizationId: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    propertyType: {
      type: String,
      enum: PROPERTY_TYPES,
      required: true,
      default: 'Apartment',
    },
    listingType: {
      type: String,
      enum: LISTING_TYPES,
      default: 'ForSale',
      required: true,
    },
    status: {
      type: String,
      enum: PROPERTY_STATUSES,
      default: 'Draft',
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0.01,
    },
    isDiscount: {
      type: Boolean,
      default: false,
    },
    discountedPrice: {
      type: Number,
      min: 0.01,
    },
    currency: {
      type: String,
      enum: PROPERTY_CURRENCIES,
      default: 'BDT',
    },
    bedrooms: {
      type: Number,
      min: 0,
    },
    bathrooms: {
      type: Number,
      min: 0,
    },
    area: {
      type: Number,
      min: 0,
    },
    areaUnit: {
      type: String,
      enum: AREA_UNITS,
      default: 'sqft',
    },
    yearBuilt: {
      type: Number,
      min: 1800,
      max: 2200,
    },
    parking: {
      type: Number,
      min: 0,
    },
    furnished: {
      type: Boolean,
      default: false,
    },
    address: {
      type: String,
      default: '',
    },
    city: {
      type: String,
      default: '',
      index: true,
    },
    state: {
      type: String,
      default: '',
    },
    country: {
      type: String,
      enum: PROPERTY_COUNTRIES,
      default: 'Bangladesh',
    },
    bangladeshAddress: {
      divisionId: { type: String, default: '' }, division: { type: String, default: '' },
      districtId: { type: String, default: '' }, district: { type: String, default: '' },
      upazilaId: { type: String, default: '' }, upazila: { type: String, default: '' },
      areaId: { type: String, default: '' }, area: { type: String, default: '' },
      road: { type: String, default: '' }, block: { type: String, default: '' }, sector: { type: String, default: '' },
      mouza: { type: String, default: '' }, postalCode: { type: String, default: '' }, landmark: { type: String, default: '' },
    },
    facing: { type: String, enum: PROPERTY_FACINGS },
    roadWidthFeet: { type: Number, min: 0 }, landShare: { type: String, default: '' },
    utilities: {
      electricity: { type: Boolean, default: false }, gas: { type: Boolean, default: false },
      water: { type: Boolean, default: false }, sewerage: { type: Boolean, default: false }, internet: { type: Boolean, default: false },
    },
    regulatory: {
      approvalAuthority: { type: String, enum: APPROVAL_AUTHORITIES, default: 'none' },
      approvalNumber: { type: String, default: '' },
      mutationStatus: { type: String, enum: MUTATION_STATUSES, default: 'not_applicable' },
      khatianNumber: { type: String, default: '' }, holdingTaxPaidThrough: { type: String, default: '' },
    },
    developerName: { type: String, default: '' }, handoverDate: { type: Date }, serviceCharge: { type: Number, min: 0 },
    latitude: {
      type: Number,
    },
    longitude: {
      type: Number,
    },
    mapUrl: {
      type: String,
      default: '',
      trim: true,
    },
    images: {
      type: [propertyImageSchema],
      default: [],
      validate: [
        {
          validator: (items: Array<{ isFeatured?: boolean }>) => items.length <= 20,
          message: 'A property can have up to 20 photos',
        },
        {
          validator: (items: Array<{ isFeatured?: boolean }>) => items.filter(item => item.isFeatured).length <= 1,
          message: 'Only one property photo can be featured',
        },
      ],
    },
    mediaLinks: {
      type: [propertyMediaLinkSchema],
      default: [],
      validate: [
        {
          validator: (links: Array<{ isHero?: boolean }>) => links.length <= 10,
          message: 'A property can have up to 10 hosted media links',
        },
        {
          validator: (links: Array<{ isHero?: boolean }>) => links.filter(link => link.isHero).length <= 1,
          message: 'Only one property media link can be selected as the hero media',
        },
        {
          validator: (links: Array<{ id?: string }>) => new Set(links.map(link => link.id)).size === links.length,
          message: 'Property media link IDs must be unique',
        },
      ],
    },
    amenities: {
      type: [String],
      default: [],
    },
    features: {
      type: [String],
      default: [],
    },
    agentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'Contact',
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    views: {
      type: Number,
      default: 0,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
    },
  }
)

propertySchema.index({ organizationId: 1, slug: 1 }, { unique: true })
propertySchema.index({ organizationId: 1, status: 1, price: 1 })
propertySchema.index({ organizationId: 1, propertyType: 1, listingType: 1 })
propertySchema.index({ organizationId: 1, _id: 1 })
propertySchema.index({ organizationId: 1, createdAt: -1 })
propertySchema.index({ organizationId: 1, agentId: 1, status: 1 })
propertySchema.index({ organizationId: 1, views: -1, updatedAt: -1 })

export const Property = model<IProperty, PropertyModel>('Property', propertySchema)
