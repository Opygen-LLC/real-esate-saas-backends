import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { IOrganization, IOrganizationFilter } from './organization.interface'
import { Organization } from './organization.model'
import { EntitlementService } from '../entitlement/entitlement.service'
import { assertSafeUrl, sanitizeRichText } from '../../helpers/sanitize'
import { randomUUID } from 'crypto'
import { DomainRecord } from '../domain/domain.model'
import { Cache } from '../../../shared/cache'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { buildTenantWebsiteUrl } from '../../helpers/publicWebsiteUrl'

const createOrganization = async (payload: Partial<IOrganization>): Promise<IOrganization> => {
  if (!payload.organizationId) {
    payload.organizationId = `org_${randomUUID()}`
  }

  const existingOrg = await Organization.findOne({ organizationId: payload.organizationId })
  if (existingOrg) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Organization ID already exists')
  }

  const result = await Organization.create(payload)
  return result
}

const getMyOrganization = async (organizationId: string): Promise<IOrganization | null> => {
  const [result, verifiedDomain] = await Promise.all([
    Organization.findOne({ organizationId }).lean(),
    DomainRecord.findOne({ organizationId, status: 'verified', tlsStatus: 'active' }).select('domain').lean(),
  ])
  if (!result) return null
  return {
    ...result,
    websiteStatus: result.websiteStatus || 'provisioned',
    websiteUrl: buildTenantWebsiteUrl(result.sub_domain || result.organizationId, verifiedDomain?.domain),
  } as IOrganization
}

const getOrganizationByDomain = async (domainOrSubdomain: string): Promise<IOrganization | null> => {
  const direct = await Organization.findOne({ sub_domain: domainOrSubdomain.toLowerCase() })
  if (direct) return direct
  const normalized = domainOrSubdomain.toLowerCase().replace(/^www\./, '').split(':')[0]
  const domain = await DomainRecord.findOne({ domain: normalized, status: 'verified', tlsStatus: 'active' }).lean()
  return domain ? Organization.findOne({ organizationId: domain.organizationId }) : null
}

const getPublicSiteInfo = async (identifier: string): Promise<any> => {
  const cacheKey = identifier.toLowerCase().trim()
  const cached = await Cache.tenantPublic.get<any>(cacheKey)
  if (cached) return cached

  let org: any = await Organization.findOne({ $or: [{ sub_domain: cacheKey }, { organizationId: identifier }] })
    .select('organizationId agencyName agencyType licenseNumber email phone address city state country defaultLanguage addressDetails logo favicon primaryColor secondaryColor metaTitle metaDescription sub_domain domain templateId font socialLinks websiteSettings')
    .lean()
  if (!org) {
    const normalized = cacheKey.replace(/^www\./, '').split(':')[0]
    const resolved = await Cache.tenantResolve.get(normalized)
    const verifiedDomain: any = resolved || await DomainRecord.findOne({ domain: normalized, status: 'verified', tlsStatus: 'active' }).select('organizationId').lean()
    if (verifiedDomain?.organizationId) {
      await Cache.tenantResolve.set(normalized, verifiedDomain.organizationId)
      org = await Organization.findOne({ organizationId: verifiedDomain.organizationId })
        .select('organizationId agencyName agencyType licenseNumber email phone address city state country defaultLanguage addressDetails logo favicon primaryColor secondaryColor metaTitle metaDescription sub_domain domain templateId font socialLinks websiteSettings')
        .lean()
    }
  }
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Agency website not found')

  const [totalProperties, totalAgents] = await Promise.all([
    Property.countDocuments({ organizationId: org.organizationId, status: 'Available', moderationStatus: 'approved' }),
    User.countDocuments({ organizationId: org.organizationId, userRole: { $in: ['agent', 'agency_admin', 'agency_owner', 'admin'] } }),
  ])
  const result = {
    ...org,
    defaultLanguage: org.defaultLanguage || 'en',
    metaTitle: org.metaTitle || `${org.agencyName} | Real Estate in Bangladesh`,
    metaDescription: org.metaDescription || `Browse verified real estate properties with ${org.agencyName}.`,
    templateId: org.templateId || 'template-1',
    font: org.font || 'Inter',
    stats: { totalProperties, totalAgents },
  }
  const identifiers = [cacheKey, org.organizationId, org.sub_domain, org.domain].filter(Boolean).map(String)
  await Promise.all(identifiers.map((key) => Cache.tenantPublic.set(key, result, 300)))
  await Promise.all(identifiers.map((key) => Cache.tenantResolve.set(key, org.organizationId, 300)))
  return result
}


const updateWebsiteSettings = async (
  organizationId: string,
  payload: Partial<IOrganization>
): Promise<IOrganization | null> => {
  if (payload.templateId && ['template-3', 'template-4'].includes(payload.templateId)) {
    await EntitlementService.assertFeature(organizationId, 'premiumTemplates')
  }
  const updateData: any = {
    websiteSettings: payload.websiteSettings,
    socialLinks: payload.socialLinks,
    primaryColor: payload.primaryColor,
    secondaryColor: payload.secondaryColor,
    metaTitle: payload.metaTitle,
    metaDescription: payload.metaDescription ? sanitizeRichText(payload.metaDescription) : payload.metaDescription,
    logo: payload.logo ? assertSafeUrl(payload.logo) : payload.logo,
    defaultLanguage: payload.defaultLanguage,
  }

  if (payload.templateId) updateData.templateId = payload.templateId
  if (payload.font) updateData.font = payload.font

  const result = await Organization.findOneAndUpdate(
    { organizationId },
    { $set: updateData },
    { new: true }
  )

  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  }
  await DomainEventService.emit({ organizationId, aggregateType: 'organization', aggregateId: result._id.toString(), eventType: 'organization.website_updated', payload: { fields: Object.keys(updateData).filter((key) => updateData[key] !== undefined) } })
  return result
}

const updateMyOrganization = async (
  organizationId: string,
  payload: Partial<IOrganization>
): Promise<IOrganization | null> => {
  const allowed = ['agencyName', 'agencyType', 'licenseNumber', 'address', 'city', 'state', 'country', 'zipCode', 'defaultLanguage', 'addressDetails', 'areaConversion', 'serviceAreas', 'socialLinks', 'teamSettings'] as const
  const safePayload = Object.fromEntries(allowed.filter(key => payload[key] !== undefined).map(key => [key, payload[key]]))
  const result = await Organization.findOneAndUpdate({ organizationId }, safePayload, { new: true })
  if (result) await DomainEventService.emit({ organizationId, aggregateType: 'organization', aggregateId: result._id.toString(), eventType: 'organization.updated', payload: { fields: Object.keys(safePayload) } })
  return result
}

const getAllOrganizations = async (
  filters: IOrganizationFilter,
  paginationOptions: IPaginationOptions
): Promise<IGenericResponse<IOrganization[]>> => {
  const { searchTerm, ...filterData } = filters
  const andConditions: Array<Record<string, unknown>> = []

  if (searchTerm) {
    andConditions.push({
      $or: ['agencyName', 'email', 'phone', 'city', 'organizationId'].map((field) => ({
        [field]: {
          $regex: searchTerm,
          $options: 'i',
        },
      })),
    })
  }

  if (Object.keys(filterData).length) {
    andConditions.push({
      $and: Object.entries(filterData).map(([field, value]) => ({
        [field]: value,
      })),
    })
  }

  const whereConditions = andConditions.length > 0 ? { $and: andConditions } : {}
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)

  const result = await Organization.find(whereConditions)
    .sort({ [sortBy]: sortOrder })
    .skip(skip)
    .limit(limit)

  const total = await Organization.countDocuments(whereConditions)

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: result,
  }
}

const updateOrganizationBySuperAdmin = async (
  id: string,
  payload: Partial<IOrganization>
): Promise<IOrganization | null> => {
  const safePayload: any = {}
  if (payload.subscription) {
    const subscription: any = payload.subscription
    for (const key of ['status', 'currentPeriodEnd', 'gracePeriodEnd']) {
      if (subscription[key] !== undefined) safePayload[`subscription.${key}`] = subscription[key]
    }
  }
  if (!Object.keys(safePayload).length) throw new ApiError(httpStatus.BAD_REQUEST, 'No supported platform fields supplied')
  const result = await Organization.findByIdAndUpdate(id, { $set: safePayload }, { new: true })
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  }
  return result
}

export const OrganizationService = {
  createOrganization,
  getMyOrganization,
  getOrganizationByDomain,
  getPublicSiteInfo,
  updateWebsiteSettings,
  updateMyOrganization,
  getAllOrganizations,
  updateOrganizationBySuperAdmin,
}
