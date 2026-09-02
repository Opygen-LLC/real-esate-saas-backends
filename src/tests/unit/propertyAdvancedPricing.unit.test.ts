import { describe, expect, it } from 'vitest'
import { areaSummary, convertAreaValue } from '../../app/module/localization/areaConversion'
import { PROPERTY_DOCUMENT_TYPES_BY_PROPERTY, PROPERTY_TYPE_CONFIG } from '../../app/module/property/property.constants'
import { calculateHotelInvestment, calculateMonthlyEmi, normalizePropertyFinancials } from '../../app/module/property/propertyPricing.service'
import { toPublicProperty } from '../../app/module/property/publicProperty.serializer'

const conversion = { kathaSqft: 720, bighaKatha: 20 }

describe('advanced property pricing and private investment data', () => {
  it('uses the canonical conversion engine for katha, sqft, decimal, bigha and acre summaries', () => {
    expect(convertAreaValue(5, 'katha', 'sqft', conversion)).toBe(3600)
    const summary = areaSummary(5, 'katha', conversion)
    expect(summary.values.sqft).toBe(3600)
    expect(summary.values.katha).toBe(5)
    expect(summary.values.bigha).toBe(0.25)
    expect(summary.values.acre).toBeCloseTo(3600 / 43560, 6)
  })

  it('calculates Land per-katha pricing and mirrors the result into legacy price', async () => {
    const normalized: any = await normalizePropertyFinancials('org-1', {
      propertyType: 'LandPlot',
      listingType: 'ForSale',
      area: 5,
      areaUnit: 'katha',
      price: 1,
      pricing: { mode: 'PER_KATHA', unitRate: 12_000_000, askingPrice: 1, negotiable: true },
    }, undefined, conversion)

    expect(normalized.pricing).toMatchObject({ mode: 'PER_KATHA', unitRate: 12_000_000, askingPrice: 60_000_000, negotiable: true })
    expect(normalized.price).toBe(60_000_000)
  })

  it('calculates apartment price per sqft while preserving direct total price compatibility', async () => {
    const unitPriced: any = await normalizePropertyFinancials('org-1', {
      propertyType: 'Apartment', listingType: 'ForSale', area: 2000, areaUnit: 'sqft',
      pricing: { mode: 'PER_SQFT', unitRate: 15_000, askingPrice: 1 },
    }, undefined, conversion)
    expect(unitPriced.price).toBe(30_000_000)

    const totalPriced: any = await normalizePropertyFinancials('org-1', {
      propertyType: 'Apartment', listingType: 'ForSale', price: 25_000_000,
    }, undefined, conversion)
    expect(totalPriced.pricing.mode).toBe('TOTAL')
    expect(totalPriced.price).toBe(25_000_000)
  })

  it.each([
    { name: 'Land TOTAL', propertyType: 'LandPlot', listingType: 'ForSale', area: 5, areaUnit: 'katha', mode: 'TOTAL', askingPrice: 60_000_000, expected: 60_000_000 },
    { name: 'Land PER_KATHA', propertyType: 'LandPlot', listingType: 'ForSale', area: 5, areaUnit: 'katha', mode: 'PER_KATHA', unitRate: 12_000_000, expected: 60_000_000 },
    { name: 'Land PER_SQFT', propertyType: 'LandPlot', listingType: 'ForSale', area: 5, areaUnit: 'katha', mode: 'PER_SQFT', unitRate: 1_000, expected: 3_600_000 },
    { name: 'Land PER_DECIMAL', propertyType: 'LandPlot', listingType: 'ForSale', area: 5, areaUnit: 'katha', mode: 'PER_DECIMAL', unitRate: 1_000_000 },
    { name: 'Land PER_BIGHA', propertyType: 'LandPlot', listingType: 'ForSale', area: 5, areaUnit: 'katha', mode: 'PER_BIGHA', unitRate: 100_000_000, expected: 25_000_000 },
    { name: 'Apartment TOTAL', propertyType: 'Apartment', listingType: 'ForSale', area: 2_000, areaUnit: 'sqft', mode: 'TOTAL', askingPrice: 30_000_000, expected: 30_000_000 },
    { name: 'Apartment PER_SQFT', propertyType: 'Apartment', listingType: 'ForSale', area: 2_000, areaUnit: 'sqft', mode: 'PER_SQFT', unitRate: 15_000, expected: 30_000_000 },
    { name: 'Office PER_SQFT', propertyType: 'Office', listingType: 'ForSale', area: 2_000, areaUnit: 'sqft', mode: 'PER_SQFT', unitRate: 10_000, expected: 20_000_000 },
    { name: 'Office MONTHLY', propertyType: 'Office', listingType: 'ForRent', area: 2_000, areaUnit: 'sqft', mode: 'MONTHLY', askingPrice: 150_000, expected: 150_000 },
    { name: 'Rental MONTHLY', propertyType: 'RentalSublet', listingType: 'ForRent', area: 1_500, areaUnit: 'sqft', mode: 'MONTHLY', askingPrice: 80_000, expected: 80_000 },
  ] as const)('normalizes $name pricing server-side and mirrors legacy price', async (testCase) => {
    const pricing: any = {
      mode: testCase.mode,
      ...(testCase.unitRate !== undefined ? { unitRate: testCase.unitRate } : {}),
      ...(testCase.askingPrice !== undefined ? { askingPrice: testCase.askingPrice } : {}),
    }
    const normalized: any = await normalizePropertyFinancials('org-1', {
      propertyType: testCase.propertyType,
      listingType: testCase.listingType,
      area: testCase.area,
      areaUnit: testCase.areaUnit,
      pricing,
    } as any, undefined, conversion)

    const expected = testCase.expected ?? Number((testCase.unitRate! * convertAreaValue(testCase.area, testCase.areaUnit, 'decimal', conversion)).toFixed(2))
    expect(normalized.pricing.mode).toBe(testCase.mode)
    expect(normalized.pricing.askingPrice).toBeCloseTo(expected, 2)
    expect(normalized.price).toBeCloseTo(expected, 2)
  })

  it('exposes Apartment floor but keeps Hotel area private when public area visibility is disabled', () => {
    const apartment: any = toPublicProperty({
      _id: 'apartment-1', organizationId: 'org-1', title: 'Apartment', slug: 'apartment',
      propertyType: 'Apartment', listingType: 'ForSale', status: 'Available', price: 30_000_000,
      floorNumber: 6, hiddenPublicFields: [], images: [], amenities: [], features: [],
    } as any)
    expect(apartment.floorNumber).toBe(6)

    const hotel: any = toPublicProperty({
      _id: 'hotel-2', organizationId: 'org-1', title: 'Private Area Hotel', slug: 'private-area-hotel',
      propertyType: 'HotelResort', listingType: 'ForSale', status: 'Available', price: 100_000_000,
      totalRooms: 120, starRating: 5, landArea: 2.5, landAreaUnit: 'acre', builtUpArea: 80_000, builtUpAreaUnit: 'sqft',
      hiddenPublicFields: ['area'], images: [], amenities: [], features: [],
    } as any)
    expect(hotel.totalRooms).toBe(120)
    expect(hotel.starRating).toBe(5)
    expect(hotel).not.toHaveProperty('landArea')
    expect(hotel).not.toHaveProperty('builtUpArea')
  })

  it('calculates the requested payment-plan example server-side', async () => {
    const normalized: any = await normalizePropertyFinancials('org-1', {
      propertyType: 'Apartment', listingType: 'ForSale', price: 100_000_000,
      paymentPlan: {
        type: 'INSTALLMENT', bookingAmount: 2_000_000, downPaymentPercent: 20,
        installmentCount: 24, installmentFrequency: 'MONTHLY',
      },
    }, undefined, conversion)

    expect(normalized.paymentPlan.downPaymentAmount).toBe(20_000_000)
    expect(normalized.paymentPlan.remainingAmount).toBe(78_000_000)
    expect(normalized.paymentPlan.installmentAmount).toBe(3_250_000)
  })

  it('keeps EMI informational and computes it without creating a finance-side contract', async () => {
    expect(calculateMonthlyEmi(8_000_000, 9.5, 20)).toBeGreaterThan(0)
    const normalized: any = await normalizePropertyFinancials('org-1', {
      propertyType: 'Apartment', listingType: 'ForSale', price: 10_000_000,
      financingCalculator: { enabled: true, downPaymentPercent: 20, interestRatePercent: 9.5, loanTenureYears: 20, showPublic: true },
    }, undefined, conversion)
    expect(normalized.financingCalculator.loanAmount).toBe(8_000_000)
    expect(normalized.financingCalculator.estimatedMonthlyEmi).toBeGreaterThan(0)
  })

  it('calculates hotel investment metrics and exposes only explicitly public fields', () => {
    const hotelInvestment = calculateHotelInvestment({
      annualRevenue: 20_000_000,
      operatingExpenses: 8_000_000,
      publicFields: ['pricePerRoom', 'capRatePercent'],
    }, 100_000_000, 50)!

    expect(hotelInvestment.pricePerRoom).toBe(2_000_000)
    expect(hotelInvestment.grossYieldPercent).toBe(20)
    expect(hotelInvestment.netYieldPercent).toBe(12)
    expect(hotelInvestment.capRatePercent).toBe(12)

    const publicProperty: any = toPublicProperty({
      _id: 'property-1', organizationId: 'org-1', title: 'Hotel', slug: 'hotel',
      propertyType: 'HotelResort', listingType: 'ForSale', status: 'Available', price: 100_000_000,
      hotelInvestment,
      documents: [{ assetId: 'asset-1', category: 'HotelLicense', originalName: 'license.pdf', mimeType: 'application/pdf', size: 1234, visibility: 'private' }],
      financingCalculator: { enabled: true, showPublic: false, loanAmount: 80_000_000, estimatedMonthlyEmi: 100_000 },
      hiddenPublicFields: [], images: [], amenities: [], features: [],
    } as any)

    expect(publicProperty.hotelInvestment).toEqual({ pricePerRoom: 2_000_000, capRatePercent: 12 })
    expect(publicProperty).not.toHaveProperty('documents')
    expect(publicProperty).not.toHaveProperty('financingCalculator')
  })

  it('keeps Hotel facilities and Land/Hotel document categories canonical', () => {
    expect(PROPERTY_TYPE_CONFIG.HotelResort.pricingModes).toEqual(['TOTAL'])
    expect(PROPERTY_TYPE_CONFIG.LandPlot.pricingModes).toContain('PER_ACRE')
    expect(PROPERTY_DOCUMENT_TYPES_BY_PROPERTY.LandPlot).toContain('Deed')
    expect(PROPERTY_DOCUMENT_TYPES_BY_PROPERTY.HotelResort).toContain('FinancialStatements')
  })
})
