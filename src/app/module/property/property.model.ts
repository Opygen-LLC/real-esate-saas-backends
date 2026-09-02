import { Schema, model, type HydratedDocument } from 'mongoose'
import { IProperty, PropertyModel } from './property.interface'
import { AREA_UNITS, APPROVAL_AUTHORITIES, HOTEL_INVESTMENT_FIELDS, HOTEL_OPERATING_STATUSES, HOTEL_TYPES, INSTALLMENT_FREQUENCIES, LAND_OWNERSHIP_TYPES, LAND_ROAD_TYPES, LISTING_TYPES, MUTATION_STATUSES, PROPERTY_COUNTRIES, PROPERTY_CURRENCIES, PROPERTY_DOCUMENT_TYPES, PROPERTY_FACINGS, PROPERTY_MEDIA_PROVIDERS, PROPERTY_MEDIA_TYPES, PROPERTY_PAYMENT_TYPES, PROPERTY_PRICING_MODES, PROPERTY_SPEC_FIELDS, PROPERTY_STATUSES, PROPERTY_TYPE_CONFIG, PROPERTY_TYPES, PUBLIC_PROPERTY_FIELDS, defaultAreaUnitForPropertyType, type AreaUnit, type PropertyType } from './property.constants'

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
    assetId: { type: Schema.Types.ObjectId, ref: 'WebsiteAsset', default: null },
    url: { type: String, required: true },
    publicId: { type: String, default: '' },
    caption: { type: String, default: '' },
    isFeatured: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: true }
)


const propertyPricingSchema = new Schema({
  mode: { type: String, enum: PROPERTY_PRICING_MODES, required: true },
  unitRate: { type: Number, min: 0.01 },
  askingPrice: { type: Number, required: true, min: 0.01 },
  negotiable: { type: Boolean, default: false },
}, { _id: false })

const rentalTermsSchema = new Schema({
  securityDeposit: { type: Number, min: 0 },
  advanceMonths: { type: Number, min: 0, max: 120 },
  minimumLeaseMonths: { type: Number, min: 0, max: 600 },
  availableFrom: { type: Date },
  utilityIncluded: { type: Boolean, default: false },
}, { _id: false })

const propertyPaymentPlanSchema = new Schema({
  type: { type: String, enum: PROPERTY_PAYMENT_TYPES, required: true },
  bookingAmount: { type: Number, min: 0 },
  downPaymentAmount: { type: Number, min: 0 },
  downPaymentPercent: { type: Number, min: 0, max: 100 },
  installmentCount: { type: Number, min: 1, max: 600 },
  installmentFrequency: { type: String, enum: INSTALLMENT_FREQUENCIES },
  handoverPayment: { type: Number, min: 0 },
  registrationPayment: { type: Number, min: 0 },
  remainingAmount: { type: Number, min: 0 },
  installmentAmount: { type: Number, min: 0 },
}, { _id: false })

const financingCalculatorSchema = new Schema({
  enabled: { type: Boolean, default: false },
  downPaymentPercent: { type: Number, min: 0, max: 100 },
  interestRatePercent: { type: Number, min: 0, max: 100 },
  loanTenureYears: { type: Number, min: 1, max: 50 },
  showPublic: { type: Boolean, default: false },
  loanAmount: { type: Number, min: 0 },
  estimatedMonthlyEmi: { type: Number, min: 0 },
}, { _id: false })

const hotelInvestmentSchema = new Schema({
  averageOccupancyPercent: { type: Number, min: 0, max: 100 },
  averageDailyRate: { type: Number, min: 0 },
  annualRevenue: { type: Number, min: 0 },
  operatingExpenses: { type: Number, min: 0 },
  netOperatingIncome: { type: Number, min: 0 },
  ebitda: { type: Number, min: 0 },
  publicFields: { type: [String], enum: HOTEL_INVESTMENT_FIELDS, default: [] },
  pricePerRoom: { type: Number, min: 0 },
  grossYieldPercent: { type: Number, min: 0 },
  netYieldPercent: { type: Number, min: 0 },
  capRatePercent: { type: Number, min: 0 },
}, { _id: false })

const propertyDocumentSchema = new Schema({
  assetId: { type: Schema.Types.ObjectId, ref: 'PropertyDocumentAsset', required: true },
  category: { type: String, enum: PROPERTY_DOCUMENT_TYPES, required: true },
  originalName: { type: String, required: true, trim: true, maxlength: 255 },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true, min: 0 },
  visibility: { type: String, enum: ['private'], default: 'private' },
}, { _id: false })

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
    pricing: { type: propertyPricingSchema },
    rentalTerms: { type: rentalTermsSchema },
    paymentPlan: { type: propertyPaymentPlanSchema },
    financingCalculator: { type: financingCalculatorSchema },
    hotelInvestment: { type: hotelInvestmentSchema },
    documents: { type: [propertyDocumentSchema], default: [], validate: { validator: (items: unknown[]) => items.length <= 20, message: 'A property can have up to 20 private documents' } },
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
    balconies: { type: Number, min: 0, max: 100 },
    area: {
      type: Number,
      min: 0,
    },
    areaUnit: {
      type: String,
      enum: AREA_UNITS,
      default: 'sqft',
    },
    floorNumber: { type: Number, min: 0, max: 300 },
    totalFloors: { type: Number, min: 1, max: 300 },
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
    roadWidthFeet: { type: Number, min: 0 },
    roadType: { type: String, enum: LAND_ROAD_TYPES },
    roadFrontageFeet: { type: Number, min: 0, max: 100000 },
    cornerPlot: { type: Boolean, default: false },
    plotNumber: { type: String, default: '', trim: true, maxlength: 100 },
    dagNumber: { type: String, default: '', trim: true, maxlength: 100 },
    ownershipType: { type: String, enum: LAND_OWNERSHIP_TYPES },
    landShare: { type: String, default: '' },
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
    developerName: { type: String, default: '', maxlength: 160 },
    buildingName: { type: String, default: '', maxlength: 160 },
    liftAvailable: { type: Boolean, default: false },
    generatorAvailable: { type: Boolean, default: false },
    handoverDate: { type: Date },
    serviceCharge: { type: Number, min: 0 },
    loadingAccess: { type: String, default: '', maxlength: 300 },
    hotelName: { type: String, default: '', trim: true, maxlength: 180 },
    hotelType: { type: String, enum: HOTEL_TYPES },
    starRating: { type: Number, min: 1, max: 5 },
    hotelOperatingStatus: { type: String, enum: HOTEL_OPERATING_STATUSES },
    yearEstablished: { type: Number, min: 1800, max: 2200 },
    lastRenovationYear: { type: Number, min: 1800, max: 2200 },
    totalRooms: { type: Number, min: 0, max: 100000 },
    operationalRooms: { type: Number, min: 0, max: 100000 },
    suites: { type: Number, min: 0, max: 100000 },
    villas: { type: Number, min: 0, max: 100000 },
    cottages: { type: Number, min: 0, max: 100000 },
    totalBeds: { type: Number, min: 0, max: 1000000 },
    landArea: { type: Number, min: 0, max: 1_000_000_000 },
    landAreaUnit: { type: String, enum: AREA_UNITS },
    builtUpArea: { type: Number, min: 0, max: 1_000_000_000 },
    builtUpAreaUnit: { type: String, enum: AREA_UNITS, default: 'sqft' },
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
    hiddenPublicFields: {
      type: [String],
      enum: PUBLIC_PROPERTY_FIELDS,
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
    quotaLocked: { type: Boolean, default: false, index: true },
    quotaLockedReason: { type: String, enum: ['subscription_limit', 'tenant_admin', null], default: null },
    quotaLockedAt: { type: Date, default: null },
    quotaLockedBy: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
    },
  }
)


propertySchema.pre('validate', function sanitizeTypeSpecificDefaults(this: HydratedDocument<IProperty>) {
  const propertyType = this.propertyType as PropertyType | undefined
  if (!propertyType) return
  const config = PROPERTY_TYPE_CONFIG[propertyType]

  const allowed = new Set<string>(config.fields)
  for (const field of PROPERTY_SPEC_FIELDS) {
    if (!allowed.has(field)) this.set(field, undefined)
  }

  if (allowed.has('areaUnit')) {
    const areaUnit = this.areaUnit as AreaUnit | undefined
    if (!areaUnit || !(config.areaUnits as readonly string[]).includes(areaUnit)) {
      this.set('areaUnit', defaultAreaUnitForPropertyType(propertyType))
    }
  }
})

propertySchema.index({ organizationId: 1, slug: 1 }, { unique: true })
propertySchema.index({ organizationId: 1, status: 1, price: 1 })
propertySchema.index({ organizationId: 1, propertyType: 1, listingType: 1 })
propertySchema.index({ organizationId: 1, _id: 1 })
propertySchema.index({ organizationId: 1, createdAt: -1 })
propertySchema.index({ organizationId: 1, createdAt: -1, _id: -1 }, { name: 'property_tenant_created_cursor' })
propertySchema.index({ organizationId: 1, status: 1, createdAt: -1, _id: -1 }, { name: 'property_tenant_status_created_cursor' })
propertySchema.index({ organizationId: 1, agentId: 1, status: 1 })
propertySchema.index({ organizationId: 1, views: -1, updatedAt: -1 })

propertySchema.index({ organizationId: 1, quotaLocked: 1, status: 1, createdAt: 1 })

export const Property = model<IProperty, PropertyModel>('Property', propertySchema)
