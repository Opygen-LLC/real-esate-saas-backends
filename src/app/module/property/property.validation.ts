import { z } from 'zod'

const propertyTypes = ['Apartment', 'LandPlot', 'Commercial', 'Office', 'Shop', 'Warehouse', 'ReadyFlat', 'UnderConstruction', 'RentalSublet'] as const
const statuses = ['Draft', 'Available', 'Reserved', 'UnderOffer', 'Sold', 'Rented', 'OffMarket', 'ComingSoon'] as const
const address = z.object({
  divisionId: z.string().max(12).optional(), division: z.string().max(80).optional(),
  districtId: z.string().max(12).optional(), district: z.string().max(80).optional(),
  upazilaId: z.string().max(12).optional(), upazila: z.string().max(80).optional(),
  areaId: z.string().max(12).optional(), area: z.string().max(100).optional(),
  road: z.string().max(100).optional(), block: z.string().max(50).optional(), sector: z.string().max(50).optional(),
  mouza: z.string().max(100).optional(), postalCode: z.string().regex(/^\d{4}$/).optional(), landmark: z.string().max(200).optional(),
}).strict()

const googleMapsUrl = z.string().trim().url().max(2048).refine((value) => {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    if (hostname === 'maps.app.goo.gl' || hostname === 'maps.google.com') return true
    if (hostname === 'goo.gl') return url.pathname.startsWith('/maps')
    if (hostname === 'www.google.com' || hostname === 'google.com') return url.pathname.startsWith('/maps')
    return false
  } catch {
    return false
  }
}, 'A valid Google Maps link is required')


const imageMime = z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const assetVariant = z.object({
  key: z.string().min(1).max(1200),
  format: z.enum(['webp', 'avif']),
  width: z.number().int().positive(),
  height: z.number().int().positive().optional(),
}).strict()

const image = z.object({ url: z.string().url(), publicId: z.string().max(200).optional(), caption: z.string().max(200).optional(),
  isFeatured: z.boolean().optional(), order: z.number().int().nonnegative().optional() }).strict()
const propertyImages = z.array(image).max(20).superRefine((items, ctx) => {
  if (items.filter(item => item.isFeatured).length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only one property photo can be featured' })
  }
})
const mediaLink = z.object({
  id: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(2048).refine(value => value.startsWith('https://'), 'Media URL must use HTTPS'),
  provider: z.enum(['youtube', 'vimeo', 'matterport', 'kuula', 'other']).optional(),
  type: z.enum(['video', 'virtual_tour', '360']),
  title: z.string().trim().max(160).optional(),
  embedUrl: z.string().trim().url().max(2048).optional(),
  isHero: z.boolean().optional(),
}).strict()
const mediaLinks = z.array(mediaLink).max(10).superRefine((items, ctx) => {
  if (items.filter(item => item.isHero).length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only one media item can be selected as hero media' })
  }
  const ids = items.map(item => item.id)
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Media item IDs must be unique' })
  }
})
const fields = {
  title: z.string().trim().min(3).max(180), description: z.string().max(20000).optional(),
  propertyType: z.enum(propertyTypes), listingType: z.enum(['ForSale', 'ForRent', 'ForLease']), status: z.enum(statuses).optional(),
  price: z.number().nonnegative().max(1_000_000_000_000), currency: z.literal('BDT').default('BDT'),
  bedrooms: z.number().int().nonnegative().max(100).optional(), bathrooms: z.number().nonnegative().max(100).optional(),
  area: z.number().nonnegative().max(1_000_000_000).optional(), areaUnit: z.enum(['sqft', 'decimal', 'shotok', 'katha', 'bigha', 'acre']).default('sqft'),
  yearBuilt: z.number().int().min(1800).max(2200).optional(), parking: z.number().int().nonnegative().max(1000).optional(), furnished: z.boolean().optional(),
  address: z.string().max(500).optional(), city: z.string().max(100).optional(), state: z.string().max(100).optional(),
  country: z.literal('Bangladesh').default('Bangladesh'), zipCode: z.string().regex(/^\d{4}$/).optional(),
  bangladeshAddress: address.optional(), latitude: z.number().min(20).max(27).optional(), longitude: z.number().min(88).max(93).optional(), mapUrl: z.union([z.literal(''), googleMapsUrl]).optional(),
  facing: z.enum(['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest']).optional(),
  roadWidthFeet: z.number().nonnegative().max(1000).optional(), landShare: z.string().max(100).optional(),
  utilities: z.object({ electricity: z.boolean().optional(), gas: z.boolean().optional(), water: z.boolean().optional(),
    sewerage: z.boolean().optional(), internet: z.boolean().optional() }).strict().optional(),
  regulatory: z.object({ approvalAuthority: z.enum(['none', 'RAJUK', 'CDA', 'RDA', 'KDA', 'other']).optional(),
    approvalNumber: z.string().max(100).optional(), mutationStatus: z.enum(['not_applicable', 'pending', 'completed']).optional(),
    khatianNumber: z.string().max(100).optional(), holdingTaxPaidThrough: z.string().max(30).optional() }).strict().optional(),
  developerName: z.string().max(160).optional(), handoverDate: z.coerce.date().optional(), serviceCharge: z.number().nonnegative().max(100_000_000).optional(),
  images: propertyImages.optional(), mediaLinks: mediaLinks.optional(),
  amenities: z.array(z.string().max(100)).max(100).optional(), features: z.array(z.string().max(100)).max(100).optional(),
  agentId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(), ownerId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(), isFeatured: z.boolean().optional(),
}

export const PropertyValidation = {
  presignImageZodSchema: z.object({ body: z.object({ filename: z.string().min(1).max(255), mimeType: imageMime, size: z.number().int().positive().max(20 * 1024 * 1024) }).strict() }),
  completeImageZodSchema: z.object({ body: z.object({ key: z.string().min(1).max(1024), originalName: z.string().max(255).optional(), mimeType: imageMime, width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), altText: z.string().max(300).optional(), variants: z.array(assetVariant).max(8).optional() }).strict() }),
  createPropertyZodSchema: z.object({ body: z.object(fields).strict() }),
  updatePropertyZodSchema: z.object({ body: z.object(Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.optional()])))
    .strict().refine(value => Object.keys(value).length > 0, 'At least one field is required') }),
  updateStatusZodSchema: z.object({ body: z.object({ status: z.enum(statuses) }).strict() }),
  reorderImagesZodSchema: z.object({ body: z.object({ images: propertyImages }).strict() }),
  importImageUrlZodSchema: z.object({ body: z.object({ url: z.string().trim().url().max(2048).refine((value) => value.startsWith('https://'), 'Image URL must use HTTPS'), altText: z.string().trim().max(200).optional() }).strict() }),
}
