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
      enum: ['Apartment', 'LandPlot', 'Commercial', 'Office', 'Shop', 'Warehouse', 'ReadyFlat', 'UnderConstruction', 'RentalSublet'],
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
      enum: ['BDT'],
      default: 'BDT',
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
      enum: ['sqft', 'decimal', 'shotok', 'katha', 'bigha', 'acre'],
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
      enum: ['Bangladesh'],
      default: 'Bangladesh',
    },
    zipCode: {
      type: String,
      default: '',
    },
    bangladeshAddress: {
      divisionId: { type: String, default: '' }, division: { type: String, default: '' },
      districtId: { type: String, default: '' }, district: { type: String, default: '' },
      upazilaId: { type: String, default: '' }, upazila: { type: String, default: '' },
      areaId: { type: String, default: '' }, area: { type: String, default: '' },
      road: { type: String, default: '' }, block: { type: String, default: '' }, sector: { type: String, default: '' },
      mouza: { type: String, default: '' }, postalCode: { type: String, default: '' }, landmark: { type: String, default: '' },
    },
    facing: { type: String, enum: ['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'] },
    roadWidthFeet: { type: Number, min: 0 }, landShare: { type: String, default: '' },
    utilities: {
      electricity: { type: Boolean, default: false }, gas: { type: Boolean, default: false },
      water: { type: Boolean, default: false }, sewerage: { type: Boolean, default: false }, internet: { type: Boolean, default: false },
    },
    regulatory: {
      approvalAuthority: { type: String, enum: ['none', 'RAJUK', 'CDA', 'RDA', 'KDA', 'other'], default: 'none' },
      approvalNumber: { type: String, default: '' },
      mutationStatus: { type: String, enum: ['not_applicable', 'pending', 'completed'], default: 'not_applicable' },
      khatianNumber: { type: String, default: '' }, holdingTaxPaidThrough: { type: String, default: '' },
    },
    developerName: { type: String, default: '' }, handoverDate: { type: Date }, serviceCharge: { type: Number, min: 0, default: 0 },
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
    moderationStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'flagged'], default: 'pending', index: true },
    moderationReason: { type: String, default: '' }, moderatedBy: { type: String, default: '' }, moderatedAt: { type: Date },
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
propertySchema.index({ organizationId: 1, moderationStatus: 1, status: 1 })
propertySchema.index({ organizationId: 1, _id: 1 })

export const Property = model<IProperty, PropertyModel>('Property', propertySchema)
