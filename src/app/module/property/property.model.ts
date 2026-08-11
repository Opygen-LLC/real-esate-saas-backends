import { Schema, model } from 'mongoose'
import { IProperty, PropertyModel } from './property.interface'

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
      required: true,
      default: 'Apartment',
    },
    listingType: {
      type: String,
      enum: ['ForSale', 'ForRent', 'ForLease'],
      default: 'ForSale',
      required: true,
    },
    status: {
      type: String,
      enum: [
        'Draft',
        'Available',
        'Reserved',
        'UnderOffer',
        'Sold',
        'Rented',
        'OffMarket',
        'ComingSoon',
      ],
      default: 'Available',
      required: true,
    },
    price: {
      type: Number,
      required: true,
      default: 0,
    },
    currency: {
      type: String,
      default: 'USD',
    },
    bedrooms: {
      type: Number,
      default: 1,
    },
    bathrooms: {
      type: Number,
      default: 1,
    },
    area: {
      type: Number,
      default: 0,
    },
    areaUnit: {
      type: String,
      enum: ['sqft', 'sqm', 'marla', 'decimal', 'acre'],
      default: 'sqft',
    },
    yearBuilt: {
      type: Number,
      default: () => new Date().getFullYear(),
    },
    parking: {
      type: Number,
      default: 0,
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
      default: 'USA',
    },
    zipCode: {
      type: String,
      default: '',
    },
    latitude: {
      type: Number,
    },
    longitude: {
      type: Number,
    },
    images: {
      type: [propertyImageSchema],
      default: [],
    },
    videos: {
      type: [String],
      default: [],
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
      default: Date.now,
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

export const Property = model<IProperty, PropertyModel>('Property', propertySchema)
