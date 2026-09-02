import type { IProperty, IPropertyImage, IPropertyMediaLink } from './property.interface'
import type { PublicPropertyField } from './property.constants'

export type PublicPropertyDto = Omit<Partial<IProperty>, 'agentId'> & {
  _id?: unknown
  agentId?: Record<string, unknown>
}

const toPlain = (value: any): Record<string, any> => {
  if (!value) return {}
  if (typeof value.toObject === 'function') return value.toObject({ virtuals: false, getters: false })
  return { ...value }
}

const safeAgent = (value: any): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const agent = toPlain(value)
  const result: Record<string, unknown> = {}
  for (const key of ['_id', 'name', 'email', 'phoneNumber', 'profileImgURL', 'licenseNumber', 'bio', 'userRole']) {
    if (agent[key] !== undefined && agent[key] !== null && agent[key] !== '') result[key] = agent[key]
  }
  return Object.keys(result).length ? result : undefined
}

const publicBangladeshAddress = (source: any, hidden: Set<PublicPropertyField>) => {
  const address = source && typeof source === 'object' ? source : {}
  const result: Record<string, unknown> = {}
  if (!hidden.has('location')) {
    for (const key of ['divisionId', 'division', 'districtId', 'district', 'upazilaId', 'upazila', 'areaId', 'area']) {
      if (address[key] !== undefined && address[key] !== null && address[key] !== '') result[key] = address[key]
    }
  }
  if (!hidden.has('address')) {
    for (const key of ['road', 'block', 'sector', 'mouza', 'postalCode', 'landmark']) {
      if (address[key] !== undefined && address[key] !== null && address[key] !== '') result[key] = address[key]
    }
  }
  return Object.keys(result).length ? result : undefined
}

/**
 * The only supported projection for public property payloads.
 * Hidden values are physically omitted, rather than marked client-side, so
 * public JSON, templates, share cards and agent listing payloads cannot expose them.
 */
export const toPublicProperty = (input: any): PublicPropertyDto => {
  const property = toPlain(input)
  const hidden = new Set<PublicPropertyField>(Array.isArray(property.hiddenPublicFields) ? property.hiddenPublicFields : [])
  const result: Record<string, any> = {}

  for (const key of ['_id', 'organizationId', 'title', 'slug', 'propertyType', 'listingType', 'status', 'publishedAt', 'isFeatured', 'createdAt', 'updatedAt']) {
    if (property[key] !== undefined && property[key] !== null) result[key] = property[key]
  }

  if (Array.isArray(property.images)) result.images = property.images as IPropertyImage[]
  if (Array.isArray(property.mediaLinks)) result.mediaLinks = property.mediaLinks as IPropertyMediaLink[]

  if (!hidden.has('description') && property.description) result.description = property.description

  if (!hidden.has('price')) {
    result.price = property.price
    result.currency = property.currency || 'BDT'
    if (property.pricing) {
      result.pricing = {
        mode: property.pricing.mode,
        ...(property.pricing.unitRate !== undefined ? { unitRate: property.pricing.unitRate } : {}),
        askingPrice: property.pricing.askingPrice,
        negotiable: Boolean(property.pricing.negotiable),
      }
    }
    if (property.rentalTerms) result.rentalTerms = property.rentalTerms
    if (property.paymentPlan) result.paymentPlan = property.paymentPlan
    if (property.financingCalculator?.enabled && property.financingCalculator?.showPublic) {
      result.financingCalculator = {
        enabled: true,
        downPaymentPercent: property.financingCalculator.downPaymentPercent,
        interestRatePercent: property.financingCalculator.interestRatePercent,
        loanTenureYears: property.financingCalculator.loanTenureYears,
        loanAmount: property.financingCalculator.loanAmount,
        estimatedMonthlyEmi: property.financingCalculator.estimatedMonthlyEmi,
        showPublic: true,
      }
    }
    if (!hidden.has('discount')) {
      if (property.isDiscount !== undefined) result.isDiscount = property.isDiscount
      if (property.discountedPrice !== undefined) result.discountedPrice = property.discountedPrice
    }
  }

  if (!hidden.has('location')) {
    for (const key of ['city', 'state', 'country']) if (property[key]) result[key] = property[key]
  }
  if (!hidden.has('address') && property.address) result.address = property.address
  const bdAddress = publicBangladeshAddress(property.bangladeshAddress, hidden)
  if (bdAddress) result.bangladeshAddress = bdAddress

  if (!hidden.has('map')) {
    for (const key of ['latitude', 'longitude', 'mapUrl']) {
      if (property[key] !== undefined && property[key] !== null && property[key] !== '') result[key] = property[key]
    }
  }

  const scalarVisibility: Array<[PublicPropertyField, string]> = [
    ['bedrooms', 'bedrooms'],
    ['bathrooms', 'bathrooms'],
    ['yearBuilt', 'yearBuilt'],
    ['parking', 'parking'],
    ['furnished', 'furnished'],
    ['landShare', 'landShare'],
    ['serviceCharge', 'serviceCharge'],
    ['developer', 'developerName'],
    ['handover', 'handoverDate'],
    ['facing', 'facing'],
    ['roadWidth', 'roadWidthFeet'],
  ]
  for (const [visibility, key] of scalarVisibility) {
    if (!hidden.has(visibility) && property[key] !== undefined && property[key] !== null && property[key] !== '') result[key] = property[key]
  }

  if (!hidden.has('area') && property.area !== undefined && property.area !== null) {
    result.area = property.area
    result.areaUnit = property.areaUnit
  }
  if (property.propertyType === 'HotelResort') {
    for (const key of [
      'hotelName', 'hotelType', 'starRating', 'hotelOperatingStatus', 'yearEstablished', 'lastRenovationYear',
      'totalRooms', 'operationalRooms', 'suites', 'villas', 'cottages', 'totalBeds', 'landArea', 'landAreaUnit',
      'builtUpArea', 'builtUpAreaUnit',
    ]) {
      if (property[key] !== undefined && property[key] !== null && property[key] !== '') result[key] = property[key]
    }
    if (property.hotelInvestment && Array.isArray(property.hotelInvestment.publicFields)) {
      const publicInvestment: Record<string, unknown> = {}
      for (const key of property.hotelInvestment.publicFields) {
        if (property.hotelInvestment[key] !== undefined && property.hotelInvestment[key] !== null) {
          publicInvestment[key] = property.hotelInvestment[key]
        }
      }
      if (Object.keys(publicInvestment).length) result.hotelInvestment = publicInvestment
    }
  }

  if (!hidden.has('utilities') && property.utilities) result.utilities = property.utilities
  if (!hidden.has('regulatory') && property.regulatory) result.regulatory = property.regulatory
  if (!hidden.has('amenities') && Array.isArray(property.amenities)) result.amenities = property.amenities
  if (!hidden.has('features') && Array.isArray(property.features)) result.features = property.features
  if (!hidden.has('agent')) {
    const agent = safeAgent(property.agentId)
    if (agent) result.agentId = agent
  }

  return result as PublicPropertyDto
}

export const toPublicProperties = (items: any[]): PublicPropertyDto[] => items.map(toPublicProperty)
