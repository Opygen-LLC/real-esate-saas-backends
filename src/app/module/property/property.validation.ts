import { z } from 'zod'

const createPropertyZodSchema = z.object({
  body: z.object({
    title: z.string({ required_error: 'Property title is required' }),
    description: z.string().optional(),
    propertyType: z.string({ required_error: 'Property type is required' }),
    listingType: z.enum(['ForSale', 'ForRent', 'ForLease']),
    status: z
      .enum([
        'Draft',
        'Available',
        'Reserved',
        'UnderOffer',
        'Sold',
        'Rented',
        'OffMarket',
        'ComingSoon',
      ])
      .optional(),
    price: z.number({ required_error: 'Price is required' }),
    currency: z.string().optional(),
    bedrooms: z.number().optional(),
    bathrooms: z.number().optional(),
    area: z.number().optional(),
    areaUnit: z.enum(['sqft', 'sqm', 'marla', 'decimal', 'acre']).optional(),
    yearBuilt: z.number().optional(),
    parking: z.number().optional(),
    furnished: z.boolean().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    zipCode: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    images: z
      .array(
        z.object({
          url: z.string(),
          publicId: z.string().optional(),
          caption: z.string().optional(),
          isFeatured: z.boolean().optional(),
          order: z.number().optional(),
        })
      )
      .optional(),
    videos: z.array(z.string()).optional(),
    amenities: z.array(z.string()).optional(),
    features: z.array(z.string()).optional(),
    agentId: z.string().optional(),
    ownerId: z.string().optional(),
    isFeatured: z.boolean().optional(),
  }),
})

const updatePropertyZodSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    propertyType: z.string().optional(),
    listingType: z.enum(['ForSale', 'ForRent', 'ForLease']).optional(),
    status: z
      .enum([
        'Draft',
        'Available',
        'Reserved',
        'UnderOffer',
        'Sold',
        'Rented',
        'OffMarket',
        'ComingSoon',
      ])
      .optional(),
    price: z.number().optional(),
    currency: z.string().optional(),
    bedrooms: z.number().optional(),
    bathrooms: z.number().optional(),
    area: z.number().optional(),
    areaUnit: z.enum(['sqft', 'sqm', 'marla', 'decimal', 'acre']).optional(),
    yearBuilt: z.number().optional(),
    parking: z.number().optional(),
    furnished: z.boolean().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    zipCode: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    images: z
      .array(
        z.object({
          url: z.string(),
          publicId: z.string().optional(),
          caption: z.string().optional(),
          isFeatured: z.boolean().optional(),
          order: z.number().optional(),
        })
      )
      .optional(),
    videos: z.array(z.string()).optional(),
    amenities: z.array(z.string()).optional(),
    features: z.array(z.string()).optional(),
    agentId: z.string().optional(),
    ownerId: z.string().optional(),
    isFeatured: z.boolean().optional(),
  }),
})

const updateStatusZodSchema = z.object({
  body: z.object({
    status: z.enum([
      'Draft',
      'Available',
      'Reserved',
      'UnderOffer',
      'Sold',
      'Rented',
      'OffMarket',
      'ComingSoon',
    ]),
  }),
})

export const PropertyValidation = {
  createPropertyZodSchema,
  updatePropertyZodSchema,
  updateStatusZodSchema,
}
