import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { IProperty, IPropertyFilter, IPropertyImage } from './property.interface'
import { Property } from './property.model'
import { Organization } from '../organization/organization.model'
import { sanitizeRichText } from '../../helpers/sanitize'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { normalizePropertyMediaLinks } from './propertyMedia.service'

type PropertyActor = { id?: string; role?: string; canPublish?: boolean }

const generateSlug = async (organizationId: string, title: string): Promise<string> => {
  let baseSlug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

  if (!baseSlug) baseSlug = 'property'

  let slug = baseSlug
  let count = 1

  while (await Property.findOne({ organizationId, slug })) {
    slug = `${baseSlug}-${count}`
    count++
  }

  return slug
}

const createProperty = async (
  organizationId: string,
  payload: Partial<IProperty>,
  actor?: PropertyActor,
): Promise<IProperty> => {
  if (!payload.title) throw new ApiError(httpStatus.BAD_REQUEST, 'Property title is required')

  const slug = await generateSlug(organizationId, payload.title)
  const status: IProperty['status'] = actor?.canPublish ? (payload.status || 'Draft') : 'Draft'
  const mediaLinks = normalizePropertyMediaLinks(payload.mediaLinks)
  const propertyData: Partial<IProperty> = {
    ...payload,
    ...(mediaLinks !== undefined ? { mediaLinks } : {}),
    organizationId,
    slug,
    status,
    views: 0,
    currency: 'BDT',
    country: 'Bangladesh',
    description: payload.description ? sanitizeRichText(payload.description) : '',
    publishedAt: status === 'Available' ? new Date() : undefined,
  }

  const result = await Property.create(propertyData)
  await CacheInvalidationService.invalidateTenant(organizationId)
  return result
}

const getAllProperties = async (
  filters: IPropertyFilter,
  paginationOptions: IPaginationOptions,
): Promise<IGenericResponse<IProperty[]>> => {
  const {
    searchTerm,
    organizationId,
    propertyType,
    listingType,
    status,
    city,
    state,
    divisionId,
    districtId,
    upazilaId,
    minPrice,
    maxPrice,
    bedrooms,
    bathrooms,
    furnished,
    isFeatured,
    agentId,
  } = filters

  const andConditions: Array<Record<string, unknown>> = []

  if (organizationId) {
    const org = await Organization.findOne({
      $or: [
        { organizationId },
        { sub_domain: { $regex: `^${organizationId}$`, $options: 'i' } },
        { domain: { $regex: `^${organizationId}$`, $options: 'i' } },
        { customDomain: { $regex: `^${organizationId}$`, $options: 'i' } },
      ],
    })

    if (org) {
      andConditions.push({
        $or: [
          { organizationId: org.organizationId },
          { organizationId: org.sub_domain },
          { organizationId: org._id.toString() },
          { organizationId },
        ],
      })
    } else andConditions.push({ organizationId })
  }

  if (searchTerm) {
    andConditions.push({
      $or: ['title', 'description', 'address', 'city', 'state', 'zipCode'].map((field) => ({
        [field]: { $regex: searchTerm, $options: 'i' },
      })),
    })
  }

  if (propertyType) andConditions.push({ propertyType })
  if (listingType) andConditions.push({ listingType })
  if (status) andConditions.push({ status })
  if (city) andConditions.push({ city: { $regex: city, $options: 'i' } })
  if (state) andConditions.push({ state: { $regex: state, $options: 'i' } })
  if (divisionId) andConditions.push({ 'bangladeshAddress.divisionId': divisionId })
  if (districtId) andConditions.push({ 'bangladeshAddress.districtId': districtId })
  if (upazilaId) andConditions.push({ 'bangladeshAddress.upazilaId': upazilaId })
  if (agentId) andConditions.push({ agentId })

  if (minPrice !== undefined && minPrice !== '') andConditions.push({ price: { $gte: Number(minPrice) } })
  if (maxPrice !== undefined && maxPrice !== '') andConditions.push({ price: { $lte: Number(maxPrice) } })
  if (bedrooms !== undefined && bedrooms !== '') andConditions.push({ bedrooms: Number(bedrooms) })
  if (bathrooms !== undefined && bathrooms !== '') andConditions.push({ bathrooms: Number(bathrooms) })
  if (furnished !== undefined && furnished !== '') andConditions.push({ furnished: furnished === 'true' || furnished === true })
  if (isFeatured !== undefined && isFeatured !== '') andConditions.push({ isFeatured: isFeatured === 'true' || isFeatured === true })

  const whereCondition = andConditions.length > 0 ? { $and: andConditions } : {}
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)

  const [result, total] = await Promise.all([
    Property.find(whereCondition)
      .populate('agentId', 'name email phoneNumber profileImgURL licenseNumber')
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit),
    Property.countDocuments(whereCondition),
  ])

  return { meta: { page, limit, total }, data: result }
}

const getPublicProperties = async (
  organizationId: string,
  filters: IPropertyFilter,
  paginationOptions: IPaginationOptions,
): Promise<IGenericResponse<IProperty[]>> => getAllProperties(
  { ...filters, organizationId, status: 'Available' },
  paginationOptions,
)

const getPropertyById = async (organizationId: string, id: string): Promise<IProperty | null> => {
  const result = await Property.findOne({ _id: id, organizationId }).populate(
    'agentId',
    'name email phoneNumber profileImgURL licenseNumber bio',
  )
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  return result
}

const getPropertyBySlug = async (organizationId: string, slug: string): Promise<IProperty | null> => {
  const result = await Property.findOne({ slug, organizationId, status: 'Available' }).populate(
    'agentId',
    'name email phoneNumber profileImgURL licenseNumber bio',
  )
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  return result
}

const getPublicPropertyDetail = async (
  idOrSlug: string,
  organizationId?: string,
): Promise<{ property: IProperty; similarProperties: IProperty[] }> => {
  const isObjectId = idOrSlug.match(/^[0-9a-fA-F]{24}$/)
  const tenantScope = organizationId ? { organizationId } : {}
  const query = isObjectId
    ? { _id: idOrSlug, ...tenantScope, status: 'Available' }
    : { slug: idOrSlug, ...tenantScope, status: 'Available' }

  const property = await Property.findOneAndUpdate(query, { $inc: { views: 1 } }, { new: true })
    .populate('agentId', 'name email phoneNumber profileImgURL licenseNumber bio specialization')

  if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')

  const similarProperties = await Property.find({
    organizationId: property.organizationId,
    _id: { $ne: property._id },
    status: 'Available',
    $or: [{ city: property.city }, { propertyType: property.propertyType }],
  }).limit(3).populate('agentId', 'name email profileImgURL')

  return { property, similarProperties }
}

const updateProperty = async (
  organizationId: string,
  id: string,
  payload: Partial<IProperty>,
  actor?: PropertyActor,
): Promise<IProperty | null> => {
  const existing = await Property.findOne({ _id: id, organizationId })
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')

  if (payload.status !== undefined && payload.status !== existing.status && !actor?.canPublish) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Missing permission: properties.publish')
  }
  if (payload.title && payload.title !== existing.title) payload.slug = await generateSlug(organizationId, payload.title)
  if (payload.mediaLinks !== undefined) payload.mediaLinks = normalizePropertyMediaLinks(payload.mediaLinks)

  payload.currency = 'BDT'
  payload.country = 'Bangladesh'
  if (payload.description !== undefined) payload.description = sanitizeRichText(payload.description)
  if (payload.status === 'Available' && existing.status !== 'Available' && !existing.publishedAt) payload.publishedAt = new Date()

  const result = await Property.findOneAndUpdate({ _id: id, organizationId }, payload, { new: true })
    .populate('agentId', 'name email phoneNumber profileImgURL')

  await CacheInvalidationService.invalidateTenant(organizationId)
  return result
}

const updatePropertyStatus = async (
  organizationId: string,
  id: string,
  status: string,
  actor?: PropertyActor,
): Promise<IProperty | null> => {
  if (!actor?.canPublish) throw new ApiError(httpStatus.FORBIDDEN, 'Missing permission: properties.publish')
  const existing = await Property.findOne({ _id: id, organizationId }).select('_id status publishedAt')
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')

  const update: Partial<IProperty> = { status: status as IProperty['status'] }
  if (status === 'Available' && existing.status !== 'Available' && !existing.publishedAt) update.publishedAt = new Date()

  const result = await Property.findOneAndUpdate({ _id: id, organizationId }, update, { new: true })
  await CacheInvalidationService.invalidateTenant(organizationId)
  return result
}

const reorderPropertyImages = async (organizationId: string, id: string, images: IPropertyImage[]): Promise<IProperty | null> => {
  const result = await Property.findOneAndUpdate({ _id: id, organizationId }, { images }, { new: true })
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  await CacheInvalidationService.invalidateTenant(organizationId)
  return result
}

const deleteProperty = async (organizationId: string, id: string): Promise<IProperty | null> => {
  const result = await Property.findOneAndDelete({ _id: id, organizationId })
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  await CacheInvalidationService.invalidateTenant(organizationId)
  return result
}

export const PropertyService = {
  createProperty,
  getAllProperties,
  getPublicProperties,
  getPropertyById,
  getPropertyBySlug,
  getPublicPropertyDetail,
  updateProperty,
  updatePropertyStatus,
  reorderPropertyImages,
  deleteProperty,
}
