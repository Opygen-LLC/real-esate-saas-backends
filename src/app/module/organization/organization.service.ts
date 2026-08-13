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
  const result = await Organization.findOne({ organizationId })
  return result
}

const getOrganizationByDomain = async (domainOrSubdomain: string): Promise<IOrganization | null> => {
  const result = await Organization.findOne({
    $or: [{ domain: domainOrSubdomain }, { sub_domain: domainOrSubdomain }],
  })
  return result
}

const getPublicSiteInfo = async (identifier: string): Promise<any> => {
  const org = await Organization.findOne({
    $or: [{ sub_domain: identifier }, { domain: identifier }, { organizationId: identifier }],
  })

  if (!org) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Agency website not found')
  }

  const totalProperties = await Property.countDocuments({
    organizationId: org.organizationId,
    status: 'Available',
  })
  const totalAgents = await User.countDocuments({
    organizationId: org.organizationId,
    userRole: { $in: ['agent', 'agency_admin', 'agency_owner', 'admin'] },
  })

  return {
    organizationId: org.organizationId,
    agencyName: org.agencyName,
    agencyType: org.agencyType,
    licenseNumber: org.licenseNumber,
    email: org.email,
    phone: org.phone,
    address: org.address,
    city: org.city,
    state: org.state,
    country: org.country,
    logo: org.logo,
    favicon: org.favicon,
    primaryColor: org.primaryColor,
    secondaryColor: org.secondaryColor,
    metaTitle: org.metaTitle || `${org.agencyName} | Luxury Real Estate & Homes for Sale`,
    metaDescription:
      org.metaDescription || `Browse verified real estate properties and luxury estates with ${org.agencyName}.`,
    sub_domain: org.sub_domain,
    domain: org.domain,
    templateId: org.templateId || 'template-1',
    font: org.font || 'Inter',
    socialLinks: org.socialLinks,
    websiteSettings: org.websiteSettings,
    stats: {
      totalProperties,
      totalAgents,
      experienceYears: 12,
      happyClients: 1500,
    },
  }
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
  return result
}

const updateMyOrganization = async (
  organizationId: string,
  payload: Partial<IOrganization>
): Promise<IOrganization | null> => {
  const allowed = ['agencyName', 'agencyType', 'licenseNumber', 'address', 'city', 'state', 'country', 'zipCode', 'serviceAreas', 'socialLinks', 'teamSettings'] as const
  const safePayload = Object.fromEntries(allowed.filter(key => payload[key] !== undefined).map(key => [key, payload[key]]))
  const result = await Organization.findOneAndUpdate({ organizationId }, safePayload, {
    new: true,
  })
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
  const result = await Organization.findByIdAndUpdate(id, payload, { new: true })
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
