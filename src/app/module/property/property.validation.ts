import { z } from 'zod'
import { AREA_UNITS, APPROVAL_AUTHORITIES, LISTING_TYPES, MUTATION_STATUSES, PROPERTY_FACINGS, PROPERTY_MEDIA_PROVIDERS, PROPERTY_MEDIA_TYPES, PROPERTY_STATUSES, PROPERTY_TYPES } from './property.constants'
import { normalizeBangladeshDigits } from './property.normalization'


const postalCode = z.preprocess(
  value => typeof value === 'string' ? normalizeBangladeshDigits(value).trim() : value,
  z.string().regex(/^\d{4}$/, 'Postal code must contain exactly 4 digits'),
)

const address = z.object({
  divisionId: z.string().max(12).optional(), division: z.string().max(80).optional(),
  districtId: z.string().max(12).optional(), district: z.string().max(80).optional(),
  upazilaId: z.string().max(12).optional(), upazila: z.string().max(80).optional(),
  areaId: z.string().max(12).optional(), area: z.string().max(100).optional(),
  road: z.string().max(100).optional(), block: z.string().max(50).optional(), sector: z.string().max(50).optional(),
  mouza: z.string().max(100).optional(), postalCode: postalCode.optional(), landmark: z.string().max(200).optional(),
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

const image = z.object({ _id: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(), assetId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(), url: z.string().url(), publicId: z.string().max(1200).optional(), caption: z.string().max(200).optional(),
  isFeatured: z.boolean().optional(), order: z.number().int().nonnegative().optional() }).strict()
const propertyImages = z.array(image).max(20).superRefine((items, ctx) => {
  if (items.filter(item => item.isFeatured).length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only one property photo can be featured' })
  }
})
const mediaLink = z.object({
  id: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(2048).refine(value => value.startsWith('https://'), 'Media URL must use HTTPS'),
  provider: z.enum(PROPERTY_MEDIA_PROVIDERS).optional(),
  type: z.enum(PROPERTY_MEDIA_TYPES),
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
  propertyType: z.enum(PROPERTY_TYPES), listingType: z.enum(LISTING_TYPES), status: z.enum(PROPERTY_STATUSES).optional(),
  price: z.number().positive('Listing price must be greater than zero').max(1_000_000_000_000),
  isDiscount: z.boolean().optional(), discountedPrice: z.number().positive('Discounted price must be greater than zero').max(1_000_000_000_000).optional(),
  currency: z.literal('BDT').default('BDT'),
  bedrooms: z.number().int().nonnegative().max(100).optional(), bathrooms: z.number().nonnegative().max(100).optional(),
  area: z.number().nonnegative().max(1_000_000_000).optional(), areaUnit: z.enum(AREA_UNITS).default('sqft'),
  yearBuilt: z.number().int().min(1800).max(2200).optional(), parking: z.number().int().nonnegative().max(1000).optional(), furnished: z.boolean().optional(),
  address: z.string().max(500).optional(), city: z.string().max(100).optional(), state: z.string().max(100).optional(),
  country: z.literal('Bangladesh').default('Bangladesh'),
  // zipCode is accepted only for rolling-deploy compatibility; validateRequest transforms it into bangladeshAddress.postalCode.
  zipCode: postalCode.optional(),
  bangladeshAddress: address.optional(), latitude: z.number().min(20).max(27).optional(), longitude: z.number().min(88).max(93).optional(), mapUrl: z.union([z.literal(''), googleMapsUrl]).optional(),
  facing: z.enum(PROPERTY_FACINGS).optional(),
  roadWidthFeet: z.number().nonnegative().max(1000).optional(), landShare: z.string().max(100).optional(),
  utilities: z.object({ electricity: z.boolean().optional(), gas: z.boolean().optional(), water: z.boolean().optional(),
    sewerage: z.boolean().optional(), internet: z.boolean().optional() }).strict().optional(),
  regulatory: z.object({ approvalAuthority: z.enum(APPROVAL_AUTHORITIES).optional(),
    approvalNumber: z.string().max(100).optional(), mutationStatus: z.enum(MUTATION_STATUSES).optional(),
    khatianNumber: z.string().max(100).optional(), holdingTaxPaidThrough: z.string().max(30).optional() }).strict().optional(),
  developerName: z.string().max(160).optional(), handoverDate: z.coerce.date().optional(), serviceCharge: z.number().nonnegative().max(100_000_000).optional(),
  images: propertyImages.optional(), mediaLinks: mediaLinks.optional(),
  amenities: z.array(z.string().max(100)).max(100).optional(), features: z.array(z.string().max(100)).max(100).optional(),
  agentId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(), ownerId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(), isFeatured: z.boolean().optional(),
}

type PropertyInput = Record<string, any>
const canonicalizePostalCode = (value: PropertyInput): PropertyInput => {
  const { zipCode, ...rest } = value
  const canonical = rest.bangladeshAddress?.postalCode || zipCode
  if (!canonical) return rest
  return {
    ...rest,
    bangladeshAddress: { ...(rest.bangladeshAddress || {}), postalCode: canonical },
  }
}

const validateDiscount = (value: PropertyInput, ctx: z.RefinementCtx) => {
  if (value.discountedPrice !== undefined && value.price !== undefined && value.discountedPrice >= value.price) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discountedPrice'], message: 'Discounted price must be lower than the listing price' })
  }
  if (value.isDiscount === true && value.discountedPrice === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discountedPrice'], message: 'Discounted price is required when discount is enabled' })
  }
}

const createBody = z.object({ ...fields, propertyDraftSessionId: z.string().uuid().optional() }).strict().superRefine((value, ctx) => {
  validateDiscount(value, ctx)
  if (value.images?.some((item) => item.assetId) && !value.propertyDraftSessionId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['propertyDraftSessionId'], message: 'Property draft upload session is required for uploaded images' })
  }
}).transform(canonicalizePostalCode)
const updateBody = z.object(Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.optional()])))
  .strict()
  .refine(value => Object.keys(value).length > 0, 'At least one field is required')
  .superRefine(validateDiscount)
  .transform(canonicalizePostalCode)

export const PropertyValidation = {
  presignImageZodSchema: z.object({ body: z.object({ filename: z.string().min(1).max(255), mimeType: imageMime, size: z.number().int().positive().max(20 * 1024 * 1024), uploadSessionId: z.string().uuid().optional() }).strict() }),
  completeImageZodSchema: z.object({ body: z.object({ key: z.string().min(1).max(1024), originalName: z.string().max(255).optional(), mimeType: imageMime, width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), altText: z.string().max(300).optional(), variants: z.array(assetVariant).max(8).optional() }).strict() }),
  createPropertyZodSchema: z.object({ body: createBody }),
  updatePropertyZodSchema: z.object({ body: updateBody }),
  updateStatusZodSchema: z.object({ body: z.object({ status: z.enum(PROPERTY_STATUSES) }).strict() }),
  updateQuotaAccessZodSchema: z.object({ body: z.object({ active: z.boolean() }).strict() }),
  reorderImagesZodSchema: z.object({ body: z.object({ images: propertyImages }).strict() }),
  importImageUrlZodSchema: z.object({ body: z.object({ url: z.string().trim().url().max(2048).refine((value) => value.startsWith('https://'), 'Image URL must use HTTPS'), altText: z.string().trim().max(200).optional(), uploadSessionId: z.string().uuid().optional() }).strict() }),
  cleanupDraftSessionZodSchema: z.object({ params: z.object({ sessionId: z.string().uuid() }) }),
  deleteDraftAssetZodSchema: z.object({ params: z.object({ sessionId: z.string().uuid(), assetId: z.string().regex(/^[0-9a-fA-F]{24}$/) }) }),
  confirmImportZodSchema: z.object({ body: z.object({ importSessionId: z.string().uuid() }).strict() }),
}
