import { describe, expect, it } from 'vitest'
import { PUBLIC_PROPERTY_FIELDS } from '../../app/module/property/property.constants'
import { toPublicProperty } from '../../app/module/property/publicProperty.serializer'

const fullProperty = () => ({
  _id: 'property-1',
  organizationId: 'org-1',
  title: 'Private-field regression property',
  slug: 'private-field-regression-property',
  propertyType: 'Apartment',
  listingType: 'ForSale',
  status: 'Available',
  description: 'Secret description',
  price: 25000000,
  currency: 'BDT',
  isDiscount: true,
  discountedPrice: 24000000,
  city: 'Dhaka',
  state: 'Dhaka',
  country: 'Bangladesh',
  address: 'Road 1, House 2',
  bangladeshAddress: {
    divisionId: 'division-1', division: 'Dhaka', districtId: 'district-1', district: 'Dhaka',
    upazilaId: 'upazila-1', upazila: 'Gulshan', areaId: 'area-1', area: 'Gulshan 1',
    road: 'Road 1', block: 'A', sector: '1', mouza: 'Mouza', postalCode: '1212', landmark: 'Landmark',
  },
  latitude: 23.7806,
  longitude: 90.4070,
  mapUrl: 'https://maps.example/property',
  bedrooms: 4,
  bathrooms: 3,
  area: 2200,
  areaUnit: 'sqft',
  landShare: '1.5 katha',
  yearBuilt: 2025,
  parking: 2,
  furnished: true,
  serviceCharge: 15000,
  developerName: 'Private Developer',
  handoverDate: new Date('2027-01-01T00:00:00.000Z'),
  facing: 'North',
  roadWidthFeet: 40,
  utilities: { gas: true, electricity: true, water: true },
  regulatory: { approvalAuthority: 'RAJUK', approvalNumber: 'RAJUK-123' },
  amenities: ['Gym', 'Pool'],
  features: ['Corner unit'],
  images: [{ url: 'https://cdn.example/property.webp', isFeatured: true, order: 0 }],
  mediaLinks: [{ url: 'https://video.example/1', provider: 'youtube', mediaType: 'video' }],
  agentId: {
    _id: 'agent-1', name: 'Public Agent', email: 'agent@example.com', phoneNumber: '+8801700000000',
    profileImgURL: 'https://cdn.example/agent.webp', licenseNumber: 'LIC-1', bio: 'Agent bio', userRole: 'agent',
    password: 'must-never-leak', refreshToken: 'must-never-leak', organizationId: 'org-1',
  },
})

describe('public property visibility serializer', () => {
  it('physically omits every supported hidden public field', () => {
    const result: any = toPublicProperty({ ...fullProperty(), hiddenPublicFields: [...PUBLIC_PROPERTY_FIELDS] })

    expect(result.title).toBe('Private-field regression property')
    expect(result.images).toHaveLength(1)
    for (const key of [
      'description', 'price', 'currency', 'isDiscount', 'discountedPrice', 'city', 'state', 'country', 'address',
      'bangladeshAddress', 'latitude', 'longitude', 'mapUrl', 'bedrooms', 'bathrooms', 'area', 'areaUnit',
      'landShare', 'yearBuilt', 'parking', 'furnished', 'serviceCharge', 'developerName', 'handoverDate',
      'facing', 'roadWidthFeet', 'utilities', 'regulatory', 'amenities', 'features', 'agentId',
    ]) {
      expect(result).not.toHaveProperty(key)
    }
    expect(result).not.toHaveProperty('hiddenPublicFields')
  })

  it('keeps location while hiding exact address and discount information', () => {
    const result: any = toPublicProperty({
      ...fullProperty(),
      hiddenPublicFields: ['address', 'discount'],
    })

    expect(result.price).toBe(25000000)
    expect(result).not.toHaveProperty('isDiscount')
    expect(result).not.toHaveProperty('discountedPrice')
    expect(result.city).toBe('Dhaka')
    expect(result).not.toHaveProperty('address')
    expect(result.bangladeshAddress).toMatchObject({ division: 'Dhaka', district: 'Dhaka', upazila: 'Gulshan', area: 'Gulshan 1' })
    expect(result.bangladeshAddress).not.toHaveProperty('road')
    expect(result.bangladeshAddress).not.toHaveProperty('postalCode')
  })

  it('whitelists agent contact fields instead of forwarding the populated user object', () => {
    const result: any = toPublicProperty({ ...fullProperty(), hiddenPublicFields: [] })

    expect(result.agentId).toMatchObject({ _id: 'agent-1', name: 'Public Agent', email: 'agent@example.com', userRole: 'agent' })
    expect(result.agentId).not.toHaveProperty('password')
    expect(result.agentId).not.toHaveProperty('refreshToken')
    expect(result.agentId).not.toHaveProperty('organizationId')
  })
})
