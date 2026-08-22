import httpStatus from 'http-status'
import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { IProperty, IPropertyFilter, IPropertyImage } from './property.interface'
import { Property } from './property.model'
import { Organization } from '../organization/organization.model'
import { sanitizeRichText } from '../../helpers/sanitize'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { normalizePropertyMediaLinks } from './propertyMedia.service'
import { userRefPopulate } from '../user/userProfile.service'
import { normalizePropertyPostalCode } from './property.normalization'
import { PUBLIC_PROPERTY_STATUSES, type PropertyStatus } from './property.constants'
import { buildCrmCsv, buildCrmXlsx, type CrmExportColumn, type CrmExportRow } from '../crm/crmExport.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { toPublicProperties, toPublicProperty, type PublicPropertyDto } from './publicProperty.serializer'

type PropertyActor = { id?: string; role?: string; canPublish?: boolean }
type PropertyCreateOptions = { session?: ClientSession | null; emitEvent?: boolean }

const isPublicPropertyStatus = (status?: string): status is PropertyStatus =>
  Boolean(status && (PUBLIC_PROPERTY_STATUSES as readonly string[]).includes(status))

const normalizeDiscount = (
  payload: Partial<IProperty>,
  current?: Pick<IProperty, 'price' | 'status' | 'isDiscount' | 'discountedPrice'>,
  canPublish = false,
): Partial<IProperty> => {
  const next: Partial<IProperty> = { ...payload }
  const price = Number(next.price ?? current?.price ?? 0)
  const explicitDiscountPrice = next.discountedPrice
  const discountPrice = explicitDiscountPrice ?? current?.discountedPrice
  const discountEnabled = next.isDiscount ?? (explicitDiscountPrice !== undefined ? explicitDiscountPrice > 0 : current?.isDiscount)

  if (discountEnabled && discountPrice !== undefined) {
    if (!(discountPrice > 0)) throw new ApiError(httpStatus.BAD_REQUEST, 'Discounted price must be greater than zero')
    if (price > 0 && discountPrice >= price) throw new ApiError(httpStatus.BAD_REQUEST, 'Discounted price must be lower than the listing price')
    next.isDiscount = true
    next.discountedPrice = discountPrice
    if (canPublish) next.status = 'UnderOffer'
  } else if (next.isDiscount === false) {
    next.discountedPrice = undefined
  }
  return next
}

const generateSlug = async (organizationId: string, title: string, session?: ClientSession | null): Promise<string> => {
  let baseSlug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

  if (!baseSlug) baseSlug = 'property'

  let slug = baseSlug
  let count = 1

  while (await Property.findOne({ organizationId, slug }).session(session || null)) {
    slug = `${baseSlug}-${count}`
    count++
  }

  return slug
}

const emitPropertyCreated = async (organizationId: string, result: any) => DomainEventService.emit({
  organizationId,
  aggregateType: 'property',
  aggregateId: result._id.toString(),
  eventType: 'property.created',
  propertyId: result._id.toString(),
  payload: { status: result.status, publicVisible: isPublicPropertyStatus(result.status) },
})

const createProperty = async (
  organizationId: string,
  payload: Partial<IProperty>,
  actor?: PropertyActor,
  options: PropertyCreateOptions = {},
): Promise<IProperty> => {
  if (!payload.title) throw new ApiError(httpStatus.BAD_REQUEST, 'Property title is required')

  const slug = await generateSlug(organizationId, payload.title, options.session)
  const postalNormalized = normalizePropertyPostalCode(payload as Partial<IProperty> & { zipCode?: string })
  const normalizedPayload = normalizeDiscount(postalNormalized, undefined, Boolean(actor?.canPublish))
  const status: IProperty['status'] = actor?.canPublish ? (normalizedPayload.status || 'Draft') : 'Draft'
  const mediaLinks = normalizePropertyMediaLinks(normalizedPayload.mediaLinks)
  const propertyData: Partial<IProperty> = {
    ...normalizedPayload,
    ...(mediaLinks !== undefined ? { mediaLinks } : {}),
    organizationId,
    slug,
    status,
    views: 0,
    currency: 'BDT',
    country: 'Bangladesh',
    description: normalizedPayload.description ? sanitizeRichText(normalizedPayload.description) : '',
    publishedAt: isPublicPropertyStatus(status) ? new Date() : undefined,
  }

  const result = options.session
    ? (await Property.create([propertyData], { session: options.session }))[0]
    : await Property.create(propertyData)
  if (options.emitEvent !== false) await emitPropertyCreated(organizationId, result)
  return result
}

const numericFilter = (value: unknown, label: string): number | undefined => {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new ApiError(httpStatus.BAD_REQUEST, `${label} must be a non-negative number`)
  return parsed
}

const PROPERTY_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'price', 'title', 'status', 'city', 'propertyType', 'listingType', 'bedrooms', 'bathrooms', 'isFeatured'])
const MAX_PROPERTY_EXPORT_ROWS = 20_000

const safePropertySort = (sortBy?: string, sortOrder?: string | number): { sortBy: string; sortOrder: 'asc' | 'desc' } => ({
  sortBy: sortBy && PROPERTY_SORT_FIELDS.has(sortBy) ? sortBy : 'createdAt',
  sortOrder: sortOrder === 'asc' || sortOrder === 1 ? 'asc' : 'desc',
})

const buildPropertyWhereCondition = async (filters: IPropertyFilter): Promise<Record<string, unknown>> => {
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
    minArea,
    maxArea,
    furnished,
    isFeatured,
    agentId,
    quotaLocked,
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
      $or: ['title', 'description', 'address', 'city', 'state', 'bangladeshAddress.postalCode'].map((field) => ({
        [field]: { $regex: searchTerm, $options: 'i' },
      })),
    })
  }

  if (propertyType) andConditions.push({ propertyType })
  if (listingType) andConditions.push({ listingType })
  if (status) andConditions.push(Array.isArray(status) ? { status: { $in: status } } : { status })
  if (city) andConditions.push({ city: { $regex: city, $options: 'i' } })
  if (state) andConditions.push({ state: { $regex: state, $options: 'i' } })
  if (divisionId) andConditions.push({ 'bangladeshAddress.divisionId': divisionId })
  if (districtId) andConditions.push({ 'bangladeshAddress.districtId': districtId })
  if (upazilaId) andConditions.push({ 'bangladeshAddress.upazilaId': upazilaId })
  if (agentId) andConditions.push({ agentId })
  if (quotaLocked === false || quotaLocked === 'false') andConditions.push({ quotaLocked: { $ne: true } })
  if (quotaLocked === true || quotaLocked === 'true') andConditions.push({ quotaLocked: true })

  const minPriceValue = numericFilter(minPrice, 'Minimum price')
  const maxPriceValue = numericFilter(maxPrice, 'Maximum price')
  const bedroomsValue = numericFilter(bedrooms, 'Bedrooms')
  const bathroomsValue = numericFilter(bathrooms, 'Bathrooms')
  const minAreaValue = numericFilter(minArea, 'Minimum area')
  const maxAreaValue = numericFilter(maxArea, 'Maximum area')
  if (minPriceValue !== undefined && maxPriceValue !== undefined && minPriceValue > maxPriceValue) throw new ApiError(httpStatus.BAD_REQUEST, 'Maximum price must be greater than or equal to minimum price')
  if (minAreaValue !== undefined && maxAreaValue !== undefined && minAreaValue > maxAreaValue) throw new ApiError(httpStatus.BAD_REQUEST, 'Maximum area must be greater than or equal to minimum area')
  if (minPriceValue !== undefined || maxPriceValue !== undefined) andConditions.push({ price: { ...(minPriceValue !== undefined ? { $gte: minPriceValue } : {}), ...(maxPriceValue !== undefined ? { $lte: maxPriceValue } : {}) } })
  if (bedroomsValue !== undefined) andConditions.push({ bedrooms: { $gte: bedroomsValue } })
  if (bathroomsValue !== undefined) andConditions.push({ bathrooms: { $gte: bathroomsValue } })
  if (minAreaValue !== undefined || maxAreaValue !== undefined) andConditions.push({ area: { ...(minAreaValue !== undefined ? { $gte: minAreaValue } : {}), ...(maxAreaValue !== undefined ? { $lte: maxAreaValue } : {}) } })
  if (furnished !== undefined && furnished !== '') andConditions.push({ furnished: furnished === 'true' || furnished === true })
  if (isFeatured !== undefined && isFeatured !== '') andConditions.push({ isFeatured: isFeatured === 'true' || isFeatured === true })

  return andConditions.length > 0 ? { $and: andConditions } : {}
}

const getAllProperties = async (
  filters: IPropertyFilter,
  paginationOptions: IPaginationOptions,
): Promise<IGenericResponse<IProperty[]>> => {
  const whereCondition = await buildPropertyWhereCondition(filters)
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)
  const safeSort = safePropertySort(sortBy, sortOrder)

  const [result, total] = await Promise.all([
    Property.find(whereCondition)
      .populate(userRefPopulate('agentId', 'name email phoneNumber userRole'))
      .sort({ [safeSort.sortBy]: safeSort.sortOrder, _id: safeSort.sortOrder })
      .skip(skip)
      .limit(limit),
    Property.countDocuments(whereCondition),
  ])

  return { meta: { page, limit, total }, data: result }
}

const PROPERTY_EXPORT_COLUMNS: CrmExportColumn[] = [
  { header: 'Title', key: 'title', width: 32 },
  { header: 'Property Type', key: 'propertyType', width: 18 },
  { header: 'Listing Type', key: 'listingType', width: 16 },
  { header: 'Status', key: 'status', width: 16 },
  { header: 'Price', key: 'price', width: 18 },
  { header: 'Currency', key: 'currency', width: 10 },
  { header: 'Postal Code', key: 'postalCode', width: 12 },
  { header: 'City', key: 'city', width: 18 },
  { header: 'State', key: 'state', width: 18 },
  { header: 'Address', key: 'address', width: 36 },
  { header: 'Bedrooms', key: 'bedrooms', width: 12 },
  { header: 'Bathrooms', key: 'bathrooms', width: 12 },
  { header: 'Area', key: 'area', width: 14 },
  { header: 'Area Unit', key: 'areaUnit', width: 12 },
  { header: 'Agent', key: 'agent', width: 28 },
  { header: 'Furnished', key: 'furnished', width: 12 },
  { header: 'Featured', key: 'isFeatured', width: 12 },
  { header: 'Created', key: 'createdAt', width: 24 },
  { header: 'Updated', key: 'updatedAt', width: 24 },
]

const getPropertyExportRows = async (
  organizationId: string,
  filters: IPropertyFilter,
  sortOptions: Pick<IPaginationOptions, 'sortBy' | 'sortOrder'>,
): Promise<CrmExportRow[]> => {
  const where = await buildPropertyWhereCondition({ ...filters, organizationId })
  const total = await Property.countDocuments(where)
  if (total > MAX_PROPERTY_EXPORT_ROWS) throw new ApiError(413, `Export contains more than ${MAX_PROPERTY_EXPORT_ROWS.toLocaleString()} rows. Narrow the filters and retry.`)
  const safeSort = safePropertySort(sortOptions.sortBy, sortOptions.sortOrder)
  const properties: any[] = await Property.find(where)
    .populate(userRefPopulate('agentId', 'name email userRole'))
    .sort({ [safeSort.sortBy]: safeSort.sortOrder, _id: safeSort.sortOrder })
    .limit(MAX_PROPERTY_EXPORT_ROWS)
    .select('title propertyType listingType status price currency bangladeshAddress city state address bedrooms bathrooms area areaUnit agentId furnished isFeatured createdAt updatedAt')
    .lean()

  return properties.map((property: any) => ({
    title: property.title,
    propertyType: property.propertyType,
    listingType: property.listingType,
    status: property.status,
    price: property.price,
    currency: property.currency || 'BDT',
    postalCode: property.bangladeshAddress?.postalCode || '',
    city: property.city || '',
    state: property.state || '',
    address: property.address || '',
    bedrooms: property.bedrooms ?? '',
    bathrooms: property.bathrooms ?? '',
    area: property.area ?? '',
    areaUnit: property.areaUnit || '',
    agent: property.agentId?.name || property.agentId?.email || '',
    furnished: Boolean(property.furnished),
    isFeatured: Boolean(property.isFeatured),
    createdAt: property.createdAt || '',
    updatedAt: property.updatedAt || '',
  }))
}

const exportCsv = async (organizationId: string, filters: IPropertyFilter, sortOptions: Pick<IPaginationOptions, 'sortBy' | 'sortOrder'>) =>
  buildCrmCsv(PROPERTY_EXPORT_COLUMNS, await getPropertyExportRows(organizationId, filters, sortOptions))

const exportXlsx = async (organizationId: string, filters: IPropertyFilter, sortOptions: Pick<IPaginationOptions, 'sortBy' | 'sortOrder'>) =>
  buildCrmXlsx('Properties', PROPERTY_EXPORT_COLUMNS, await getPropertyExportRows(organizationId, filters, sortOptions))

const getPublicProperties = async (
  organizationId: string,
  filters: IPropertyFilter,
  paginationOptions: IPaginationOptions,
): Promise<IGenericResponse<PublicPropertyDto[]>> => {
  const result = await getAllProperties(
    { ...filters, organizationId, status: [...PUBLIC_PROPERTY_STATUSES], quotaLocked: false },
    paginationOptions,
  )
  return { ...result, data: toPublicProperties(result.data as any[]) }
}

const getPropertyById = async (organizationId: string, id: string): Promise<IProperty | null> => {
  const result = await Property.findOne({ _id: id, organizationId }).populate(userRefPopulate('agentId', 'name email phoneNumber userRole'))
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  return result
}

const getPropertyBySlug = async (organizationId: string, slug: string): Promise<PublicPropertyDto> => {
  const result = await Property.findOne({ slug, organizationId, status: { $in: [...PUBLIC_PROPERTY_STATUSES] }, quotaLocked: { $ne: true } }).populate(userRefPopulate('agentId', 'name email phoneNumber userRole'))
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  return toPublicProperty(result)
}

const getPublicPropertyDetail = async (
  idOrSlug: string,
  organizationId: string,
): Promise<{ property: PublicPropertyDto; similarProperties: PublicPropertyDto[] }> => {
  const isObjectId = idOrSlug.match(/^[0-9a-fA-F]{24}$/)
  const tenantScope = { organizationId }
  const query = isObjectId
    ? { _id: idOrSlug, ...tenantScope, status: { $in: [...PUBLIC_PROPERTY_STATUSES] }, quotaLocked: { $ne: true } }
    : { slug: idOrSlug, ...tenantScope, status: { $in: [...PUBLIC_PROPERTY_STATUSES] }, quotaLocked: { $ne: true } }

  const property = await Property.findOneAndUpdate(query, { $inc: { views: 1 } }, { new: true, runValidators: true, context: 'query' })
    .populate(userRefPopulate('agentId', 'name email phoneNumber userRole'))

  if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')

  const similarProperties = await Property.find({
    organizationId: property.organizationId,
    _id: { $ne: property._id },
    status: { $in: [...PUBLIC_PROPERTY_STATUSES] },
    quotaLocked: { $ne: true },
    $or: [{ city: property.city }, { propertyType: property.propertyType }],
  }).limit(3).populate(userRefPopulate('agentId', 'name email userRole'))

  return { property: toPublicProperty(property), similarProperties: toPublicProperties(similarProperties as any[]) }
}

const updateProperty = async (
  organizationId: string,
  id: string,
  payload: Partial<IProperty>,
  actor?: PropertyActor,
): Promise<IProperty | null> => {
  const existing = await Property.findOne({ _id: id, organizationId })
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')

  if (existing.quotaLocked && payload.status && isPublicPropertyStatus(payload.status)) {
    throw new ApiError(httpStatus.CONFLICT, 'This property is locked by the subscription limit. Unlock it before publishing.', '', 'PROPERTY_QUOTA_LOCKED', { propertyId: id, quotaLockedReason: existing.quotaLockedReason })
  }

  const clearDiscountPrice = payload.isDiscount === false
  payload = normalizePropertyPostalCode(payload as Partial<IProperty> & { zipCode?: string })
  payload = normalizeDiscount(payload, existing, Boolean(actor?.canPublish))

  if (payload.status !== undefined && payload.status !== existing.status && !actor?.canPublish) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Missing permission: properties.publish')
  }
  if (payload.title && payload.title !== existing.title) payload.slug = await generateSlug(organizationId, payload.title)
  if (payload.mediaLinks !== undefined) payload.mediaLinks = normalizePropertyMediaLinks(payload.mediaLinks)

  payload.currency = 'BDT'
  payload.country = 'Bangladesh'
  if (payload.description !== undefined) payload.description = sanitizeRichText(payload.description)
  if (payload.status && isPublicPropertyStatus(payload.status) && !isPublicPropertyStatus(existing.status) && !existing.publishedAt) payload.publishedAt = new Date()

  const updateDocument = clearDiscountPrice
    ? { $set: Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)), $unset: { discountedPrice: 1 } }
    : payload
  const result = await Property.findOneAndUpdate({ _id: id, organizationId }, updateDocument, { new: true, runValidators: true, context: 'query' })
    .populate(userRefPopulate('agentId', 'name email phoneNumber userRole'))

  if (result) {
    await DomainEventService.emit({
      organizationId,
      aggregateType: 'property',
      aggregateId: id,
      eventType: 'property.updated',
      propertyId: id,
      payload: {
        status: result.status,
        previousStatus: existing.status,
        publicVisible: isPublicPropertyStatus(existing.status) || isPublicPropertyStatus(result.status),
        changedFields: [...Object.keys(payload), ...(clearDiscountPrice ? ['discountedPrice'] : [])],
      },
    })
  }
  return result
}

const updatePropertyStatus = async (
  organizationId: string,
  id: string,
  status: PropertyStatus,
  actor?: PropertyActor,
): Promise<IProperty | null> => {
  if (!actor?.canPublish) throw new ApiError(httpStatus.FORBIDDEN, 'Missing permission: properties.publish')
  const existing = await Property.findOne({ _id: id, organizationId }).select('_id status publishedAt quotaLocked quotaLockedReason')
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  if (existing.quotaLocked && isPublicPropertyStatus(status)) {
    throw new ApiError(httpStatus.CONFLICT, 'This property is locked by the subscription limit. Unlock it before publishing.', '', 'PROPERTY_QUOTA_LOCKED', { propertyId: id, quotaLockedReason: existing.quotaLockedReason })
  }

  const update: Partial<IProperty> = { status }
  if (isPublicPropertyStatus(status) && !isPublicPropertyStatus(existing.status) && !existing.publishedAt) update.publishedAt = new Date()

  const result = await Property.findOneAndUpdate({ _id: id, organizationId }, update, { new: true, runValidators: true, context: 'query' })
  if (result) {
    await DomainEventService.emit({
      organizationId,
      aggregateType: 'property',
      aggregateId: id,
      eventType: 'property.status_changed',
      propertyId: id,
      payload: { status, previousStatus: existing.status, publicVisible: isPublicPropertyStatus(existing.status) || isPublicPropertyStatus(status) },
    })
  }
  return result
}


const setQuotaAccess = async (
  organizationId: string,
  id: string,
  active: boolean,
  actorId = 'tenant-admin',
): Promise<IProperty | null> => {
  const result = await EntitlementService.withPropertyQuotaGuard(organizationId, async (session) => {
    const query = Property.findOne({ _id: id, organizationId })
    if (session) query.session(session)
    const property: any = await query
    if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')

    if (active) {
      if (!property.quotaLocked) return property
      const consumesSeat = !['Sold', 'Rented', 'OffMarket'].includes(String(property.status))
      if (consumesSeat) await EntitlementService.assertPropertyCapacity(organizationId, { additionalCommitments: 1, session })
      property.quotaLocked = false
      property.quotaLockedReason = null
      property.quotaLockedAt = null
      property.quotaLockedBy = null
    } else {
      if (property.quotaLocked && property.quotaLockedReason === 'tenant_admin') return property
      property.quotaLocked = true
      property.quotaLockedReason = 'tenant_admin'
      property.quotaLockedAt = new Date()
      property.quotaLockedBy = actorId
    }
    await property.save(session ? { session } : undefined)
    return property
  })

  if (result) {
    await DomainEventService.emit({
      organizationId,
      aggregateType: 'property',
      aggregateId: id,
      eventType: 'property.updated',
      actorId,
      propertyId: id,
      payload: { changedFields: ['quotaLocked', 'quotaLockedReason'], quotaLocked: Boolean((result as any).quotaLocked), publicVisible: isPublicPropertyStatus((result as any).status) && !(result as any).quotaLocked },
    })
  }
  return result
}

const reorderPropertyImages = async (organizationId: string, id: string, images: IPropertyImage[]): Promise<IProperty | null> => {
  const result = await Property.findOneAndUpdate({ _id: id, organizationId }, { images }, { new: true, runValidators: true, context: 'query' })
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  await DomainEventService.emit({
    organizationId, aggregateType: 'property', aggregateId: id, eventType: 'property.updated', propertyId: id,
    payload: { changedFields: ['images'], status: result.status, publicVisible: isPublicPropertyStatus(result.status) },
  })
  return result
}

const deleteProperty = async (organizationId: string, id: string): Promise<IProperty | null> => {
  const result = await Property.findOneAndDelete({ _id: id, organizationId })
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  await DomainEventService.emit({
    organizationId, aggregateType: 'property', aggregateId: id, eventType: 'property.deleted', propertyId: id,
    payload: { status: result.status, publicVisible: isPublicPropertyStatus(result.status) },
  })
  return result
}

export const PropertyService = { emitPropertyCreated,
  createProperty,
  getAllProperties,
  getPublicProperties,
  getPropertyById,
  getPropertyBySlug,
  getPublicPropertyDetail,
  updateProperty,
  updatePropertyStatus,
  setQuotaAccess,
  reorderPropertyImages,
  deleteProperty,
  exportCsv,
  exportXlsx,
}
