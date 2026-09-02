import { describe, expect, it } from 'vitest'
import {
  PROPERTY_TYPE_CONFIG,
  PROPERTY_TYPES,
  defaultListingTypeForPropertyType,
  isListingTypeAllowedForPropertyType,
} from '../../app/module/property/property.constants'
import { Property } from '../../app/module/property/property.model'
import { PropertyValidation } from '../../app/module/property/property.validation'
import { propertyTypeUnsetDocument, sanitizePropertyTypePayload } from '../../app/module/property/propertyTypePolicy'

describe('canonical property type architecture', () => {
  it('adds HotelResort and keeps type/listing capability rules centralized', () => {
    expect(PROPERTY_TYPES).toContain('HotelResort')
    expect(PROPERTY_TYPE_CONFIG.Apartment.listingTypes).toEqual(['ForSale', 'ForRent'])
    expect(PROPERTY_TYPE_CONFIG.LandPlot.listingTypes).toEqual(['ForSale', 'ForLease'])
    expect(PROPERTY_TYPE_CONFIG.HotelResort.listingTypes).toEqual(['ForSale', 'ForLease'])
    expect(PROPERTY_TYPE_CONFIG.Office.listingTypes).toEqual(['ForSale', 'ForRent', 'ForLease'])
    expect(PROPERTY_TYPE_CONFIG.LandPlot.pricingModes).toContain('PER_KATHA')
    expect(PROPERTY_TYPE_CONFIG.HotelResort.wizardSteps[3]).toBe('Hotel Operations')
  })

  it('removes Apartment-only values when a payload becomes LandPlot', () => {
    const sanitized = sanitizePropertyTypePayload({
      propertyType: 'LandPlot',
      bedrooms: 3,
      bathrooms: 3,
      balconies: 2,
      furnished: true,
      buildingName: 'Residential Tower',
      liftAvailable: true,
      generatorAvailable: true,
      area: 5,
      areaUnit: 'katha',
      roadWidthFeet: 30,
      plotNumber: 'P-22',
    }, 'LandPlot')

    expect(sanitized.bedrooms).toBeUndefined()
    expect(sanitized.bathrooms).toBeUndefined()
    expect(sanitized.balconies).toBeUndefined()
    expect(sanitized.furnished).toBeUndefined()
    expect(sanitized.buildingName).toBeUndefined()
    expect(sanitized.liftAvailable).toBeUndefined()
    expect(sanitized.generatorAvailable).toBeUndefined()
    expect(sanitized.area).toBe(5)
    expect(sanitized.areaUnit).toBe('katha')
    expect(sanitized.roadWidthFeet).toBe(30)
    expect(sanitized.plotNumber).toBe('P-22')
  })

  it('unsets Land/Hotel fields when switching back to a residential or office type', () => {
    const apartmentUnset = propertyTypeUnsetDocument('Apartment')
    expect(apartmentUnset.plotNumber).toBe(1)
    expect(apartmentUnset.roadFrontageFeet).toBe(1)
    expect(apartmentUnset.hotelName).toBe(1)
    expect(apartmentUnset.totalRooms).toBe(1)

    const officeUnset = propertyTypeUnsetDocument('Office')
    expect(officeUnset.hotelName).toBe(1)
    expect(officeUnset.totalRooms).toBe(1)
    expect(officeUnset.plotNumber).toBe(1)
  })

  it('rejects unsupported listing modes at the request contract', () => {
    const result = PropertyValidation.createPropertyZodSchema.safeParse({
      body: {
        title: 'Land listing',
        propertyType: 'LandPlot',
        listingType: 'ForRent',
        price: 1_000_000,
      },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'body.listingType')).toBe(true)
    }

    expect(isListingTypeAllowedForPropertyType('RentalSublet', 'ForSale')).toBe(false)
    expect(defaultListingTypeForPropertyType('UnderConstruction')).toBe('ForSale')
  })

  it('prevents mongoose defaults from reintroducing unsupported type-specific fields', async () => {
    const land = new Property({
      organizationId: 'tenant-a',
      title: 'Clean Land',
      slug: 'clean-land',
      propertyType: 'LandPlot',
      listingType: 'ForSale',
      status: 'Draft',
      price: 10_000_000,
      bedrooms: 4,
      furnished: true,
      buildingName: 'Should disappear',
      area: 5,
      areaUnit: 'katha',
    })

    await land.validate()
    expect(land.get('bedrooms')).toBeUndefined()
    expect(land.get('furnished')).toBeUndefined()
    expect(land.get('buildingName')).toBeUndefined()
    expect(land.get('areaUnit')).toBe('katha')

    const hotel = new Property({
      organizationId: 'tenant-a',
      title: 'Resort',
      slug: 'resort',
      propertyType: 'HotelResort',
      listingType: 'ForSale',
      status: 'Draft',
      price: 100_000_000,
      hotelName: 'Sea Resort',
      totalRooms: 50,
      bedrooms: 10,
    })
    await hotel.validate()
    expect(hotel.get('hotelName')).toBe('Sea Resort')
    expect(hotel.get('totalRooms')).toBe(50)
    expect(hotel.get('bedrooms')).toBeUndefined()
    expect(hotel.get('areaUnit')).toBeUndefined()
  })
})
