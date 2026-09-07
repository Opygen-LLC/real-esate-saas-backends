import httpStatus from 'http-status'
import { Types, type ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { finalizeCursorPage, parseDateCursorValue, prepareCursorPagination } from '../../helpers/cursorPagination'
import { createQueryProfile } from '../../helpers/queryPerformance'
import { exactCaseInsensitiveRegex, safeRegexPattern } from '../../helpers/searchQuery'
import { IProperty, IPropertyFilter, IPropertyImage } from './property.interface'
import { Property } from './property.model'
import { Organization } from '../organization/organization.model'
import { sanitizeRichText } from '../../helpers/sanitize'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { normalizePropertyMediaLinks } from './propertyMedia.service'
import { userRefPopulate } from '../user/userProfile.service'
import { normalizePropertyPostalCode } from './property.normalization'
import { PUBLIC_PROPERTY_STATUSES, defaultListingTypeForPropertyType, isListingTypeAllowedForPropertyType, type ListingType, type PropertyStatus, type PropertyType } from './property.constants'
import { propertyTypeUnsetDocument, sanitizePropertyTypePayload } from './propertyTypePolicy'
import { PropertyOwnershipService } from './propertyOwnership.service'
import { normalizePropertyFinancials, propertyFinancialFieldsToUnset } from './propertyPricing.service'
import { buildCrmCsv, buildCrmXlsx, type CrmExportColumn, type CrmExportRow } from '../crm/crmExport.service'
import { CrmAssignableMemberService } from '../crm/crmAssignableMember.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { toPublicProperties, toPublicProperty, type PublicPropertyDto } from './publicProperty.serializer'
import { TenantAccessService } from '../tenantAccess/tenantAccess.service'
import { logger } from '../../../shared/logger'
import { buildCatalogPlan, requiresCatalogComputation } from './propertyCatalog.pipeline'
import { parsePublicPropertyQuery, CATALOG_CONTRACT_VERSION } from '../../../contracts/websiteCatalog/query'
import { PUBLIC_FILTER_VISIBILITY, parsePublicPropertySelection } from '../../../contracts/websiteCatalog/publicProperty'

type PropertyActor = { id?: string; role?: string; canPublish?: boolean }
type PropertyCreateOptions = { session?: ClientSession | null; emitEvent?: boolean }
type PropertyUpdateOptions = { session?: ClientSession | null; emitEvent?: boolean }

const getAreaConversionSettings = async (organizationId: string, session?: ClientSession | null) => {
  const query = Organization.findOne({ organizationId }).select('areaConversion').lean()
  if (session) query.session(session)
  const organization: any = await query
  return {
    kathaSqft: Number(organization?.areaConversion?.kathaSqft || 720),
    bighaKatha: Number(organization?.areaConversion?.bighaKatha || 20),
  }
}

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

const persistPropertyEvent = async (input: Parameters<typeof DomainEventService.emit>[0]) => {
  // Persist the audit/event record before responding, but never keep the
  // property mutation request open for Redis cache scans or public-site
  // revalidation. Those are post-commit side effects and a slow provider must
  // not turn a successful property write into a reverse-proxy 502/504.
  await DomainEventService.emit(input, { deferPublish: true })
  void DomainEventService.publish(input).catch((error) => {
    logger.warn('property_post_commit_publish_failed', {
      organizationId: input.organizationId,
      propertyId: input.propertyId || input.aggregateId,
      eventType: input.eventType,
      error,
    })
  })
}

const emitPropertyCreated = async (organizationId: string, result: any) => persistPropertyEvent({
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
  if (!payload.propertyType) throw new ApiError(httpStatus.BAD_REQUEST, 'Property type is required')
  if (!payload.listingType) throw new ApiError(httpStatus.BAD_REQUEST, 'Listing type is required')
  if (!isListingTypeAllowedForPropertyType(payload.propertyType as PropertyType, payload.listingType as ListingType)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `${payload.listingType} is not valid for ${payload.propertyType}`)
  }

  const slug = await generateSlug(organizationId, payload.title, options.session)
  const postalNormalized = normalizePropertyPostalCode(payload as Partial<IProperty> & { zipCode?: string })
  const typedPayload = sanitizePropertyTypePayload(postalNormalized as Record<string, any>, payload.propertyType as PropertyType) as Partial<IProperty>
  const conversion = await getAreaConversionSettings(organizationId, options.session)
  const financialPayload = await normalizePropertyFinancials(organizationId, typedPayload, undefined, conversion)
  const normalizedPayload = normalizeDiscount(financialPayload, undefined, Boolean(actor?.canPublish))
  const status: IProperty['status'] = actor?.canPublish ? (normalizedPayload.status || 'Draft') : 'Draft'
  const mediaLinks = normalizePropertyMediaLinks(normalizedPayload.mediaLinks)
  if (normalizedPayload.agentId) {
    await CrmAssignableMemberService.assertAssignableMember(organizationId, String(normalizedPayload.agentId), 'property', options.session)
  }
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

const PROPERTY_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'price', 'pricing.unitRate', 'area', 'floorNumber', 'totalRooms', 'title', 'status', 'city', 'propertyType', 'listingType', 'bedrooms', 'bathrooms', 'isFeatured'])
const MAX_PROPERTY_EXPORT_ROWS = 20_000

const safePropertySort = (sortBy?: string, sortOrder?: string | number): { sortBy: string; sortOrder: 'asc' | 'desc' } => ({
  sortBy: sortBy && PROPERTY_SORT_FIELDS.has(sortBy) ? sortBy : 'createdAt',
  sortOrder: sortOrder === 'asc' || sortOrder === 1 ? 'asc' : 'desc',
})

const buildPropertyWhereCondition = async (filters: IPropertyFilter, publicView = false): Promise<Record<string, unknown>> => {
  const {
    searchTerm, organizationId, propertyType, listingType, status, city, state, divisionId, districtId, upazilaId,
    minPrice, maxPrice, bedrooms, bathrooms, minArea, maxArea, areaUnit, minFloor, maxFloor,
    pricingMode, minUnitRate, maxUnitRate, minRoadWidthFeet, facing, approvalAuthority,
    minRooms, starRating, hotelOperatingStatus, minLandArea, maxLandArea, landAreaUnit,
    minSecurityDeposit, availableBy, furnished, isFeatured, agentId, quotaLocked,
  } = filters

  const andConditions: Array<Record<string, unknown>> = []

  if (organizationId && publicView) {
    // Public requests use the canonical tenant ID, never a cross-tenant alias OR.
    andConditions.push({ organizationId })
  } else if (organizationId) {
    const org = await Organization.findOne({
      $or: [
        { organizationId },
        { sub_domain: exactCaseInsensitiveRegex(organizationId, { maxLength: 255, label: 'Organization identifier' }) },
        { domain: exactCaseInsensitiveRegex(organizationId, { maxLength: 255, label: 'Organization identifier' }) },
        { customDomain: exactCaseInsensitiveRegex(organizationId, { maxLength: 255, label: 'Organization identifier' }) },
      ],
    })
    if (org) {
      andConditions.push({ $or: [
        { organizationId: org.organizationId }, { organizationId: org.sub_domain }, { organizationId: org._id.toString() }, { organizationId },
      ] })
    } else andConditions.push({ organizationId })
  }

  if (searchTerm) {
    const raw = String(searchTerm).trim()
    const publicField = (name: string, condition: Record<string, unknown>) => publicView
      ? { $and: [{ hiddenPublicFields: { $ne: name } }, condition] }
      : condition
    // Free-text location and legacy styles can occupy different fields (e.g. "Gulshan Penthouse").
    const words = publicView ? raw.split(/\s+/).filter(Boolean) : [raw]
    for (const word of words) {
      const expression = { $regex: `${publicView ? '' : '^'}${safeRegexPattern(word)}`, $options: 'i' }
      andConditions.push({ $or: [
        { title: expression }, { slug: word.toLowerCase() },
        publicField('address', { address: expression }), publicField('location', { city: expression }), publicField('location', { state: expression }),
        publicField('location', { 'bangladeshAddress.area': expression }), publicField('location', { 'bangladeshAddress.upazila': expression }),
        publicField('address', { 'bangladeshAddress.mouza': expression }), publicField('address', { 'bangladeshAddress.postalCode': expression }),
        { hotelName: expression }, ...(publicView ? [] : [{ buildingName: expression }, { developerName: expression }]),
      ] })
    }
  }

  if (propertyType) andConditions.push({ propertyType })
  if (listingType) andConditions.push({ listingType })
  if (status) {
    const statusValues = (Array.isArray(status) ? status : String(status).split(',')).map((value) => String(value).trim()).filter(Boolean)
    if (statusValues.length === 1) andConditions.push({ status: statusValues[0] })
    else if (statusValues.length > 1) andConditions.push({ status: { $in: statusValues } })
  }
  if (city) andConditions.push({ city: { $regex: safeRegexPattern(city, { label: 'City filter' }), $options: 'i' } })
  if (state) andConditions.push({ state: { $regex: safeRegexPattern(state, { label: 'State filter' }), $options: 'i' } })
  if (divisionId) andConditions.push({ 'bangladeshAddress.divisionId': divisionId })
  if (districtId) andConditions.push({ 'bangladeshAddress.districtId': districtId })
  if (upazilaId) andConditions.push({ 'bangladeshAddress.upazilaId': upazilaId })
  if (agentId) {
    if (!Types.ObjectId.isValid(agentId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid property agent identifier')
    andConditions.push({ agentId: new Types.ObjectId(agentId) })
  }
  if (publicView) {
    for (const [key, field] of Object.entries(PUBLIC_FILTER_VISIBILITY)) {
      const value = filters[key as keyof IPropertyFilter]
      if (value !== undefined && value !== null && value !== '') andConditions.push({ hiddenPublicFields: { $ne: field } })
    }
  }
  if (quotaLocked === false || quotaLocked === 'false') andConditions.push({ quotaLocked: { $ne: true } })
  if (quotaLocked === true || quotaLocked === 'true') andConditions.push({ quotaLocked: true })

  const ranges: Array<[unknown, unknown, string, string]> = [
    [minFloor, maxFloor, 'floorNumber', 'Floor'],
    [minUnitRate, maxUnitRate, 'pricing.unitRate', 'Unit rate'],
  ]
  for (const [minRaw, maxRaw, field, label] of ranges) {
    const minValue = numericFilter(minRaw as any, `Minimum ${label.toLowerCase()}`)
    const maxValue = numericFilter(maxRaw as any, `Maximum ${label.toLowerCase()}`)
    if (minValue !== undefined && maxValue !== undefined && minValue > maxValue) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Maximum ${label.toLowerCase()} must be greater than or equal to minimum ${label.toLowerCase()}`)
    }
    if (minValue !== undefined || maxValue !== undefined) andConditions.push({ [field]: { ...(minValue !== undefined ? { $gte: minValue } : {}), ...(maxValue !== undefined ? { $lte: maxValue } : {}) } })
  }

  const bedroomsValue = numericFilter(bedrooms, 'Bedrooms')
  const bathroomsValue = numericFilter(bathrooms, 'Bathrooms')
  const roadWidthValue = numericFilter(minRoadWidthFeet, 'Minimum road width')
  const roomsValue = numericFilter(minRooms, 'Minimum rooms')
  const ratingValue = numericFilter(starRating, 'Star rating')
  const depositValue = numericFilter(minSecurityDeposit, 'Minimum security deposit')
  if (bedroomsValue !== undefined) andConditions.push({ bedrooms: { $gte: bedroomsValue } })
  if (bathroomsValue !== undefined) andConditions.push({ bathrooms: { $gte: bathroomsValue } })
  if (roadWidthValue !== undefined) andConditions.push({ roadWidthFeet: { $gte: roadWidthValue } })
  if (roomsValue !== undefined) andConditions.push({ totalRooms: { $gte: roomsValue } })
  if (ratingValue !== undefined) andConditions.push({ starRating: { $gte: ratingValue } })
  if (depositValue !== undefined) andConditions.push({ 'rentalTerms.securityDeposit': { $gte: depositValue } })

  // Area units qualify range inputs; comparisons use square-foot normalization.
  if (pricingMode) andConditions.push({ 'pricing.mode': pricingMode })
  if (facing) andConditions.push({ facing })
  if (approvalAuthority) andConditions.push({ 'regulatory.approvalAuthority': approvalAuthority })
  if (hotelOperatingStatus) andConditions.push({ hotelOperatingStatus })
  if (availableBy) {
    const availableDate = new Date(String(availableBy))
    if (Number.isNaN(availableDate.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, 'Available by must be a valid date')
    // Public date-only inputs use the agency timezone (Bangladesh), independent of server timezone.
    const end = new Date(`${String(availableBy).slice(0, 10)}T23:59:59.999+06:00`)
    availableDate.setTime(end.getTime())
    andConditions.push({ 'rentalTerms.availableFrom': { $lte: availableDate } })
  }
  if (furnished !== undefined && furnished !== '') andConditions.push({ furnished: furnished === 'true' || furnished === true })
  if (isFeatured !== undefined && isFeatured !== '') andConditions.push({ isFeatured: isFeatured === 'true' || isFeatured === true })

  return andConditions.length > 0 ? { $and: andConditions } : {}
}

const getAllProperties = async (
  filters: IPropertyFilter,
  paginationOptions: IPaginationOptions,
  options: { publicView?: boolean } = {},
): Promise<IGenericResponse<IProperty[]>> => {
  const organizationId = String(filters.organizationId || '')
  const profile = createQueryProfile('/api/v1/property', organizationId)
  const { sortBy, sortOrder } = paginationOptions
  const requestedSort = safePropertySort(sortBy, sortOrder)
  if (paginationOptions.cursor && (requestedSort.sortBy !== 'createdAt' || requestedSort.sortOrder !== 'desc')) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Property cursor pagination requires sortBy=createdAt&sortOrder=desc')
  }
  const cursor = prepareCursorPagination(paginationOptions, { sortField: 'createdAt', sortOrder: 'desc', parseValue: parseDateCursorValue })
  const baseWhere = await buildPropertyWhereCondition(filters, Boolean(options.publicView))
  const whereCondition = cursor.range ? { $and: [baseWhere, cursor.range] } : baseWhere
  const safeSort = cursor.cursorMode ? { sortBy: 'createdAt', sortOrder: 'desc' as const } : requestedSort

  let result: any[]
  let total: number
  const populate = userRefPopulate('agentId', 'name email phoneNumber userRole', organizationId ? { organizationId } : undefined)
  if (requiresCatalogComputation(filters, safeSort.sortBy)) {
    const conversion = await getAreaConversionSettings(organizationId)
    const plan = buildCatalogPlan({ baseWhere, filters, ...safeSort, skip: cursor.querySkip, limit: cursor.queryLimit,
      cursorRange: cursor.range, publicView: options.publicView, conversion })
    const [rows, counts] = await profile.db(() => Promise.all([
      Property.aggregate(plan.data).allowDiskUse(true).option({ maxTimeMS: 10_000 }),
      Property.aggregate<{ total: number }>(plan.count).allowDiskUse(true).option({ maxTimeMS: 10_000 }),
    ]), 2)
    result = await Property.populate(rows, { ...populate, options: { lean: true } }) as any[]
    total = counts[0]?.total || 0
  } else {
    ;[result, total] = await profile.db(() => Promise.all([
      Property.find(whereCondition).populate(populate)
        .sort({ [safeSort.sortBy]: safeSort.sortOrder, _id: safeSort.sortOrder })
        .skip(cursor.querySkip).limit(cursor.queryLimit).maxTimeMS(10_000).lean(),
      Property.countDocuments(baseWhere).maxTimeMS(10_000),
    ]), 2)
  }
  const page = finalizeCursorPage(result as any[], cursor.limit, 'createdAt', cursor.cursorMode)
  profile.finish(page.rows.length, { paginationMode: cursor.cursorMode ? 'cursor' : 'page' })

  return {
    meta: { page: cursor.page, limit: cursor.limit, total, nextCursor: page.nextCursor, hasMore: cursor.cursorMode ? page.hasMore : cursor.page * cursor.limit < total, paginationMode: cursor.cursorMode ? 'cursor' : 'page' },
    data: page.rows as IProperty[],
  }
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
  { header: 'Pricing Mode', key: 'pricingMode', width: 16 },
  { header: 'Unit Rate', key: 'unitRate', width: 18 },
  { header: 'Floor', key: 'floorNumber', width: 10 },
  { header: 'Road Width (ft)', key: 'roadWidthFeet', width: 15 },
  { header: 'Facing', key: 'facing', width: 14 },
  { header: 'Approval Authority', key: 'approvalAuthority', width: 18 },
  { header: 'Hotel Rooms', key: 'totalRooms', width: 12 },
  { header: 'Star Rating', key: 'starRating', width: 12 },
  { header: 'Hotel Status', key: 'hotelOperatingStatus', width: 20 },
  { header: 'Land Area', key: 'landArea', width: 14 },
  { header: 'Land Area Unit', key: 'landAreaUnit', width: 14 },
  { header: 'Security Deposit', key: 'securityDeposit', width: 18 },
  { header: 'Available From', key: 'availableFrom', width: 18 },
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
  const safeSort = safePropertySort(sortOptions.sortBy, sortOptions.sortOrder)
  const plan = buildCatalogPlan({ baseWhere: where, filters, ...safeSort, skip: 0, limit: MAX_PROPERTY_EXPORT_ROWS + 1,
    conversion: await getAreaConversionSettings(organizationId) })
  const rows = await Property.aggregate(plan.data).allowDiskUse(true).option({ maxTimeMS: 30_000 })
  if (rows.length > MAX_PROPERTY_EXPORT_ROWS) throw new ApiError(413, `Export contains more than ${MAX_PROPERTY_EXPORT_ROWS.toLocaleString()} rows. Narrow the filters and retry.`)
  const properties: any[] = await Property.populate(rows, { ...userRefPopulate('agentId', 'name email userRole', { organizationId }), options: { lean: true } }) as any[]

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
    pricingMode: property.pricing?.mode || 'TOTAL',
    unitRate: property.pricing?.unitRate ?? '',
    floorNumber: property.floorNumber ?? '',
    roadWidthFeet: property.roadWidthFeet ?? '',
    facing: property.facing || '',
    approvalAuthority: property.regulatory?.approvalAuthority && property.regulatory.approvalAuthority !== 'none' ? property.regulatory.approvalAuthority : '',
    totalRooms: property.totalRooms ?? '',
    starRating: property.starRating ?? '',
    hotelOperatingStatus: property.hotelOperatingStatus || '',
    landArea: property.landArea ?? '',
    landAreaUnit: property.landAreaUnit || '',
    securityDeposit: property.rentalTerms?.securityDeposit ?? '',
    availableFrom: property.rentalTerms?.availableFrom || '',
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
  const parsed = parsePublicPropertyQuery({ ...filters, ...paginationOptions })
  if (parsed.issues.length) throw new ApiError(httpStatus.BAD_REQUEST, parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '), '', 'INVALID_PUBLIC_PROPERTY_QUERY')
  await TenantAccessService.assertPublicWebsiteAccess(organizationId)
  const { page, limit, sortBy, sortOrder, cursor, ...queryFilters } = parsed.query
  const result = await getAllProperties(
    { ...queryFilters, organizationId, status: queryFilters.status || [...PUBLIC_PROPERTY_STATUSES], quotaLocked: false },
    { page, limit, sortBy, sortOrder, cursor },
    { publicView: true },
  )
  return { ...result, meta: { ...result.meta, contractVersion: CATALOG_CONTRACT_VERSION }, data: toPublicProperties(result.data as any[]) }

}

/** Resolve curated IDs to current tenant-owned public records, preserving owner selection order. */
const getPublicPropertySelection = async (organizationId: string, rawIds: unknown): Promise<PublicPropertyDto[]> => {
  let ids: string[]
  try { ids = parsePublicPropertySelection(rawIds) }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Invalid property selection') }
  await TenantAccessService.assertPublicWebsiteAccess(organizationId)
  if (!ids.length) return []
  const records = await Property.find({ organizationId, _id: { $in: ids }, status: { $in: [...PUBLIC_PROPERTY_STATUSES] }, quotaLocked: { $ne: true } })
    .populate(userRefPopulate('agentId', 'name email phoneNumber userRole', { organizationId }))
    .maxTimeMS(10_000).lean()
  const byId = new Map(toPublicProperties(records).map((record) => [record._id, record]))
  return ids.flatMap((id) => { const property = byId.get(id); return property ? [property] : [] })
}

const getPropertyById = async (organizationId: string, id: string): Promise<IProperty | null> => {
  const result = await Property.findOne({ _id: id, organizationId }).populate(userRefPopulate('agentId', 'name email phoneNumber userRole', { organizationId }))
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  return result
}

const getPropertyBySlug = async (organizationId: string, slug: string): Promise<PublicPropertyDto> => {
  await TenantAccessService.assertPublicWebsiteAccess(organizationId)
  const result = await Property.findOne({ slug, organizationId, status: { $in: [...PUBLIC_PROPERTY_STATUSES] }, quotaLocked: { $ne: true } }).populate(userRefPopulate('agentId', 'name email phoneNumber userRole', { organizationId }))
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  return toPublicProperty(result)
}

const getPublicPropertyDetail = async (
  idOrSlug: string,
  organizationId: string,
): Promise<{ property: PublicPropertyDto; similarProperties: PublicPropertyDto[] }> => {
  await TenantAccessService.assertPublicWebsiteAccess(organizationId)
  const isObjectId = idOrSlug.match(/^[0-9a-fA-F]{24}$/)
  const tenantScope = { organizationId }
  const query = isObjectId
    ? { _id: idOrSlug, ...tenantScope, status: { $in: [...PUBLIC_PROPERTY_STATUSES] }, quotaLocked: { $ne: true } }
    : { slug: idOrSlug, ...tenantScope, status: { $in: [...PUBLIC_PROPERTY_STATUSES] }, quotaLocked: { $ne: true } }

  const property = await Property.findOneAndUpdate(query, { $inc: { views: 1 } }, { new: true, runValidators: true, context: 'query' })
    .populate(userRefPopulate('agentId', 'name email phoneNumber userRole', { organizationId }))

  if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')

  const similarProperties = await Property.find({
    organizationId: property.organizationId,
    _id: { $ne: property._id },
    status: { $in: [...PUBLIC_PROPERTY_STATUSES] },
    quotaLocked: { $ne: true },
    $or: [{ city: property.city }, { propertyType: property.propertyType }],
  }).limit(3).populate(userRefPopulate('agentId', 'name email userRole', { organizationId }))

  return { property: toPublicProperty(property), similarProperties: toPublicProperties(similarProperties as any[]) }
}

const emitPropertyUpdated = async (
  organizationId: string,
  result: any,
  previousStatus: string,
  changedFields: string[],
) => persistPropertyEvent({
  organizationId,
  aggregateType: 'property',
  aggregateId: result._id.toString(),
  eventType: 'property.updated',
  propertyId: result._id.toString(),
  payload: {
    status: result.status,
    previousStatus,
    publicVisible: isPublicPropertyStatus(previousStatus) || isPublicPropertyStatus(result.status),
    changedFields,
  },
})

const updateProperty = async (
  organizationId: string,
  id: string,
  payload: Partial<IProperty>,
  actor?: PropertyActor,
  options: PropertyUpdateOptions = {},
): Promise<IProperty | null> => {
  const existingQuery = Property.findOne({ _id: id, organizationId })
  if (options.session) existingQuery.session(options.session)
  const existing = await existingQuery
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')

  if (existing.quotaLocked && payload.status && isPublicPropertyStatus(payload.status)) {
    throw new ApiError(httpStatus.CONFLICT, 'This property is locked by the subscription limit. Unlock it before publishing.', '', 'PROPERTY_QUOTA_LOCKED', { propertyId: id, quotaLockedReason: existing.quotaLockedReason })
  }

  const clearDiscountPrice = payload.isDiscount === false
  payload = normalizePropertyPostalCode(payload as Partial<IProperty> & { zipCode?: string })
  const effectiveType = (payload.propertyType || existing.propertyType) as PropertyType
  let effectiveListingType = (payload.listingType || existing.listingType) as ListingType
  if (!isListingTypeAllowedForPropertyType(effectiveType, effectiveListingType)) {
    if (payload.listingType !== undefined) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${payload.listingType} is not valid for ${effectiveType}`)
    }
    // A type-only update must never leave an impossible type/listing pair.
    payload.listingType = defaultListingTypeForPropertyType(effectiveType)
    effectiveListingType = payload.listingType
  }
  payload = sanitizePropertyTypePayload(payload as Record<string, any>, effectiveType) as Partial<IProperty>
  const conversion = await getAreaConversionSettings(organizationId, options.session)
  payload = await normalizePropertyFinancials(organizationId, payload, existing, conversion)
  payload = normalizeDiscount(payload, existing, Boolean(actor?.canPublish))

  if (payload.status !== undefined && payload.status !== existing.status && !actor?.canPublish) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Missing permission: properties.publish')
  }
  if (payload.agentId !== undefined && payload.agentId) {
    await CrmAssignableMemberService.assertAssignableMember(organizationId, String(payload.agentId), 'property', options.session)
  }
  if (payload.title && payload.title !== existing.title) payload.slug = await generateSlug(organizationId, payload.title, options.session)
  if (payload.mediaLinks !== undefined) payload.mediaLinks = normalizePropertyMediaLinks(payload.mediaLinks)

  payload.currency = 'BDT'
  payload.country = 'Bangladesh'
  if (payload.description !== undefined) payload.description = sanitizeRichText(payload.description)
  if (payload.status && isPublicPropertyStatus(payload.status) && !isPublicPropertyStatus(existing.status) && !existing.publishedAt) payload.publishedAt = new Date()

  const setDocument = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
  const unsetDocument: Record<string, 1> = propertyTypeUnsetDocument(effectiveType)
  for (const field of propertyFinancialFieldsToUnset(effectiveType, effectiveListingType)) unsetDocument[field] = 1
  if (clearDiscountPrice) unsetDocument.discountedPrice = 1
  // Never unset a field that this update explicitly sets.
  for (const key of Object.keys(setDocument)) delete unsetDocument[key]

  const query = Property.findOneAndUpdate(
    { _id: id, organizationId },
    { $set: setDocument, ...(Object.keys(unsetDocument).length ? { $unset: unsetDocument } : {}) },
    { new: true, runValidators: true, context: 'query', ...(options.session ? { session: options.session } : {}) },
  ).populate(userRefPopulate('agentId', 'name email phoneNumber userRole', { organizationId }))

  const result = await query
  if (result && options.emitEvent !== false) {
    await emitPropertyUpdated(
      organizationId,
      result,
      String(existing.status),
      [...Object.keys(setDocument), ...Object.keys(unsetDocument)],
    )
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
    await persistPropertyEvent({
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
    await persistPropertyEvent({
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
  await persistPropertyEvent({
    organizationId, aggregateType: 'property', aggregateId: id, eventType: 'property.updated', propertyId: id,
    payload: { changedFields: ['images'], status: result.status, publicVisible: isPublicPropertyStatus(result.status) },
  })
  return result
}

const deleteProperty = async (organizationId: string, id: string): Promise<IProperty | null> => {
  if (await PropertyOwnershipService.hasFinancialHistory(organizationId, id)) {
    throw new ApiError(httpStatus.CONFLICT, 'This property has investor financial history and cannot be permanently deleted. Preserve the listing for auditability or remove it from public inventory instead.', '', 'PROPERTY_INVESTOR_HISTORY_PROTECTED')
  }
  const result = await Property.findOneAndDelete({ _id: id, organizationId })
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found')
  await PropertyOwnershipService.cleanupNonFinancialRecords(organizationId, id)
  await persistPropertyEvent({
    organizationId, aggregateType: 'property', aggregateId: id, eventType: 'property.deleted', propertyId: id,
    payload: { status: result.status, publicVisible: isPublicPropertyStatus(result.status) },
  })
  return result
}

export const PropertyService = {
  emitPropertyCreated,
  emitPropertyUpdated,
  createProperty,
  getAllProperties,
  getPublicProperties,
  getPublicPropertySelection,
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
