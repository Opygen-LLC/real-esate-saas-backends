import { randomUUID } from 'crypto'
import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import { Cache } from '../../../shared/cache'
import { emitProductionEvent } from '../../../shared/productionEvents'
import paginationHelper from '../../helpers/paginationHelper'
import { buildTenantWebsiteUrl } from '../../helpers/publicWebsiteUrl'
import { assertSafeUrl, sanitizeRichText } from '../../helpers/sanitize'
import { DomainRecord } from '../domain/domain.model'
import { SubdomainAlias } from '../domain/subdomainAlias.model'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { TemplateRegistry } from '../websiteBuilder/templateRegistry'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { IOrganization, IOrganizationFilter, OnboardingStatus } from './organization.interface'
import { Organization } from './organization.model'
import { ONBOARDING_TOTAL_STEPS, ONBOARDING_VERSION, normalizeOnboardingState, normalizeOnboardingStep } from './onboarding.constants'


const definedEntries = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))


const getPublicTenantIdentifiers = async (organizationId: string, subdomain?: string): Promise<string[]> => {
  const [domains, aliases] = await Promise.all([
    DomainRecord.find({ organizationId, entitlementStatus: { $ne: 'suspended' }, status: 'verified', tlsStatus: 'active' }).select('domain').lean(),
    SubdomainAlias.find({ organizationId }).select('alias').lean(),
  ])

  return Array.from(
    new Set(
      [organizationId, subdomain, ...domains.map((record: any) => record.domain), ...aliases.map((record: any) => record.alias)]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase())
        .filter(Boolean)
    )
  )
}

const createOrganization = async (payload: Partial<IOrganization>): Promise<IOrganization> => {
  if (!payload.organizationId) payload.organizationId = `org_${randomUUID()}`
  if (await Organization.exists({ organizationId: payload.organizationId })) throw new ApiError(httpStatus.BAD_REQUEST, 'Organization ID already exists')
  return Organization.create(payload)
}

const getMyOrganization = async (organizationId: string): Promise<IOrganization | null> => {
  const [result, verifiedDomain] = await Promise.all([
    Organization.findOne({ organizationId }).lean(),
    DomainRecord.findOne({ organizationId, entitlementStatus: { $ne: 'suspended' }, status: 'verified', tlsStatus: 'active' }).select('domain').lean(),
  ])
  if (!result) return null
  return {
    ...result,
    websiteStatus: result.websiteStatus || 'published',
    onboarding: normalizeOnboardingState(result.onboarding, result.createdAt || new Date()),
    websiteUrl: buildTenantWebsiteUrl(result.sub_domain || result.organizationId, verifiedDomain?.domain),
  } as IOrganization
}

const getOrganizationByDomain = async (domainOrSubdomain: string): Promise<IOrganization | null> => {
  const normalized = domainOrSubdomain.toLowerCase().replace(/^www\./, '').split(':')[0]
  const direct = await Organization.findOne({ sub_domain: normalized })
  if (direct) return direct
  const alias = await SubdomainAlias.findOne({ alias: normalized }).lean()
  if (alias) return Organization.findOne({ organizationId: alias.organizationId })
  const domain = await DomainRecord.findOne({ domain: normalized, entitlementStatus: { $ne: 'suspended' }, status: 'verified', tlsStatus: 'active' }).lean()
  return domain ? Organization.findOne({ organizationId: domain.organizationId }) : null
}

const getPublicSiteInfo = async (identifier: string): Promise<any> => {
  const cacheKey = identifier.toLowerCase().trim()
  const cached = await Cache.tenantPublic.get<any>(cacheKey)
  if (cached) return cached

  let org: any = await Organization.findOne({ $or: [{ sub_domain: cacheKey }, { organizationId: identifier }] })
    .select('organizationId agencyName agencyType licenseNumber email phone address city state country defaultLanguage addressDetails logo favicon primaryColor secondaryColor metaTitle metaDescription sub_domain domain templateId font socialLinks websiteSettings websiteStatus entitlementRestrictions updatedAt')
    .lean()

  if (!org) {
    const alias = await SubdomainAlias.findOne({ alias: cacheKey }).lean()
    if (alias) {
      org = await Organization.findOne({ organizationId: alias.organizationId })
        .select('organizationId agencyName agencyType licenseNumber email phone address city state country defaultLanguage addressDetails logo favicon primaryColor secondaryColor metaTitle metaDescription sub_domain domain templateId font socialLinks websiteSettings websiteStatus entitlementRestrictions updatedAt')
        .lean()
    }
  }

  if (!org) {
    const normalized = cacheKey.replace(/^www\./, '').split(':')[0]
    const resolved = await Cache.tenantResolve.get(normalized)
    const verifiedDomain: any = resolved || await DomainRecord.findOne({ domain: normalized, entitlementStatus: { $ne: 'suspended' }, status: 'verified', tlsStatus: 'active' }).select('organizationId').lean()
    if (verifiedDomain?.organizationId) {
      await Cache.tenantResolve.set(normalized, verifiedDomain.organizationId)
      org = await Organization.findOne({ organizationId: verifiedDomain.organizationId })
        .select('organizationId agencyName agencyType licenseNumber email phone address city state country defaultLanguage addressDetails logo favicon primaryColor secondaryColor metaTitle metaDescription sub_domain domain templateId font socialLinks websiteSettings websiteStatus entitlementRestrictions updatedAt')
        .lean()
    }
  }

  if (!org || org.websiteStatus === 'provisioned' || org.websiteStatus === 'suspended') throw new ApiError(httpStatus.NOT_FOUND, 'Agency website is not published')

  const [totalProperties, totalAgents] = await Promise.all([
    Property.countDocuments({ organizationId: org.organizationId, status: 'Available', quotaLocked: { $ne: true } }),
    User.countDocuments({ organizationId: org.organizationId, userRole: { $in: ['agent', 'agency_admin', 'agency_owner', 'admin'] } }),
  ])
  const result = {
    ...org,
    defaultLanguage: org.defaultLanguage || 'en',
    metaTitle: org.metaTitle || `${org.agencyName} | Real Estate in Bangladesh`,
    metaDescription: org.metaDescription || `Browse verified real estate properties with ${org.agencyName}.`,
    templateId: org.entitlementRestrictions?.premiumTemplates && TemplateRegistry.isPremium(String(org.templateId || '')) ? 'template-1' : (org.templateId || 'template-1'),
    configuredTemplateId: org.templateId || 'template-1',
    font: org.font || 'Inter',
    primaryColor: org.primaryColor || '#1877F2',
    secondaryColor: org.secondaryColor || '#0f172a',
    websiteSettings: { renderMode: 'template', ...(org.websiteSettings || {}) },
    brandingVersion: org.updatedAt ? new Date(org.updatedAt).toISOString() : '',
    stats: { totalProperties, totalAgents },
  }
  const identifiers = [
    cacheKey,
    org.organizationId,
    org.sub_domain,
    ...(org.entitlementRestrictions?.customDomain ? [] : [org.domain]),
  ].filter(Boolean).map(String)
  await Promise.all(identifiers.map((key) => Cache.tenantPublic.set(key, result, 300)))
  await Promise.all(identifiers.map((key) => Cache.tenantResolve.set(key, org.organizationId, 300)))
  return result
}

const updateWebsiteSettings = async (organizationId: string, payload: Partial<IOrganization>): Promise<IOrganization | null> => {
  if (payload.templateId) await TemplateRegistry.assertEntitlement(organizationId, { template: { id: payload.templateId } })
  const previousTemplate = payload.templateId
    ? await Organization.findOne({ organizationId }).select('templateId').lean()
    : null

  const websiteSettings = payload.websiteSettings ? definedEntries(payload.websiteSettings as Record<string, unknown>) : undefined
  const updateData: Record<string, unknown> = definedEntries({
    socialLinks: payload.socialLinks,
    primaryColor: payload.primaryColor,
    secondaryColor: payload.secondaryColor,
    metaTitle: payload.metaTitle,
    metaDescription: payload.metaDescription ? sanitizeRichText(payload.metaDescription) : payload.metaDescription,
    logo: payload.logo ? assertSafeUrl(payload.logo) : payload.logo,
    defaultLanguage: payload.defaultLanguage,
    templateId: payload.templateId,
    font: payload.font,
  })

  if (websiteSettings && Object.keys(websiteSettings).length) {
    for (const [key, value] of Object.entries(websiteSettings)) updateData[`websiteSettings.${key}`] = value
  }
  if (payload.templateId) updateData['websiteSettings.renderMode'] = 'template'

  const result = await Organization.findOneAndUpdate({ organizationId }, { $set: updateData }, { new: true })
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  await CacheInvalidationService.invalidateTenant(organizationId)
  await DomainEventService.emit({ organizationId, aggregateType: 'organization', aggregateId: result._id.toString(), eventType: 'organization.website_updated', payload: { fields: Object.keys(updateData) } })
  if (payload.templateId && String(previousTemplate?.templateId || 'template-1') !== String(payload.templateId)) {
    emitProductionEvent('website_template_changed', {
      organizationId,
      fromTemplateId: String(previousTemplate?.templateId || 'template-1'),
      toTemplateId: String(payload.templateId),
      cacheInvalidated: true,
    })
  }
  return result
}


const updateBrandingSettings = async (organizationId: string, payload: Partial<IOrganization>): Promise<IOrganization> => {
  const updateData: Record<string, unknown> = definedEntries({
    primaryColor: payload.primaryColor,
    secondaryColor: payload.secondaryColor,
    font: payload.font,
    metaTitle: payload.metaTitle,
    metaDescription: payload.metaDescription ? sanitizeRichText(payload.metaDescription) : payload.metaDescription,
    logo: payload.logo ? assertSafeUrl(payload.logo) : payload.logo,
    favicon: payload.favicon ? assertSafeUrl(payload.favicon) : payload.favicon,
  })
  const result = await Organization.findOneAndUpdate({ organizationId }, { $set: updateData }, { new: true })
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')

  const tenantIdentifiers = await getPublicTenantIdentifiers(organizationId, result.sub_domain)
  await CacheInvalidationService.invalidateTenant(organizationId, tenantIdentifiers)
  await DomainEventService.emit({
    organizationId,
    aggregateType: 'organization',
    aggregateId: result._id.toString(),
    eventType: 'organization.branding_updated',
    payload: {
      fields: Object.keys(updateData),
      publicVisible: true,
      tenantIdentifiers,
      faviconChanged: Object.prototype.hasOwnProperty.call(updateData, 'favicon'),
    },
  })
  return result
}

const updateMyOrganization = async (organizationId: string, payload: Partial<IOrganization>): Promise<IOrganization | null> => {
  const allowed = ['agencyName', 'agencyType', 'email', 'phone', 'licenseNumber', 'address', 'city', 'state', 'country', 'zipCode', 'defaultLanguage', 'addressDetails', 'areaConversion', 'serviceAreas', 'socialLinks', 'teamSettings'] as const
  const safePayload = Object.fromEntries(allowed.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]))
  const result = await Organization.findOneAndUpdate({ organizationId }, { $set: safePayload }, { new: true })
  if (result) {
    await CacheInvalidationService.invalidateTenant(organizationId)
    await DomainEventService.emit({ organizationId, aggregateType: 'organization', aggregateId: result._id.toString(), eventType: 'organization.updated', payload: { fields: Object.keys(safePayload) } })
  }
  return result
}

const saveOnboarding = async (organizationId: string, payload: Record<string, any>): Promise<IOrganization> => {
  const currentStep = normalizeOnboardingStep(payload.currentStep || 1)
  const update: Record<string, unknown> = definedEntries({
    agencyName: payload.agencyName,
    agencyType: payload.agencyType,
    licenseNumber: payload.licenseNumber,
    address: payload.address,
    city: payload.city,
    state: payload.state,
    country: payload.country,
    defaultLanguage: payload.defaultLanguage,
    addressDetails: payload.addressDetails,
    serviceAreas: payload.serviceAreas,
    logo: payload.logo ? assertSafeUrl(payload.logo) : payload.logo,
    primaryColor: payload.primaryColor,
    secondaryColor: payload.secondaryColor,
    font: payload.font,
    socialLinks: payload.socialLinks,
    'onboarding.status': 'in_progress',
    'onboarding.currentStep': currentStep,
    'onboarding.version': ONBOARDING_VERSION,
  })
  if (payload.websiteSettings) for (const [key, value] of Object.entries(definedEntries(payload.websiteSettings))) update[`websiteSettings.${key}`] = value

  const result = await Organization.findOneAndUpdate({ organizationId }, { $set: update }, { new: true })
  if (!result) throw new ApiError(404, 'Organization not found')
  await CacheInvalidationService.invalidateTenant(organizationId)
  return result
}

const finalizeOnboarding = async (organizationId: string, status: Extract<OnboardingStatus, 'completed' | 'skipped'>): Promise<IOrganization> => {
  const now = new Date()
  const set: Record<string, unknown> = {
    websiteStatus: 'published',
    'onboarding.status': status,
    'onboarding.currentStep': ONBOARDING_TOTAL_STEPS,
    'onboarding.version': ONBOARDING_VERSION,
    'websiteSettings.renderMode': 'template',
    ...(status === 'completed' ? { 'onboarding.completedAt': now, 'onboarding.skippedAt': null } : { 'onboarding.skippedAt': now, 'onboarding.completedAt': null }),
  }
  const result = await Organization.findOneAndUpdate({ organizationId }, { $set: set }, { new: true })
  if (!result) throw new ApiError(404, 'Organization not found')
  await CacheInvalidationService.invalidateTenant(organizationId)
  await DomainEventService.emit({ organizationId, aggregateType: 'website', aggregateId: result._id.toString(), eventType: 'website.onboarding_finalized', payload: { status } })
  return result
}

const getAllOrganizations = async (filters: IOrganizationFilter, paginationOptions: IPaginationOptions): Promise<IGenericResponse<IOrganization[]>> => {
  const { searchTerm, ...filterData } = filters
  const andConditions: Array<Record<string, unknown>> = []
  if (searchTerm) andConditions.push({ $or: ['agencyName', 'email', 'phone', 'city', 'organizationId'].map((field) => ({ [field]: { $regex: searchTerm, $options: 'i' } })) })
  if (Object.keys(filterData).length) andConditions.push({ $and: Object.entries(filterData).map(([field, value]) => ({ [field]: value })) })
  const whereConditions = andConditions.length > 0 ? { $and: andConditions } : {}
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)
  const [result, total] = await Promise.all([
    Organization.find(whereConditions).sort({ [sortBy]: sortOrder, _id: sortOrder }).skip(skip).limit(limit),
    Organization.countDocuments(whereConditions),
  ])
  return { meta: { page, limit, total }, data: result }
}

const updateOrganizationBySuperAdmin = async (id: string, payload: Partial<IOrganization>): Promise<IOrganization | null> => {
  const safePayload: any = {}
  if (payload.subscription) {
    const subscription: any = payload.subscription
    for (const key of ['status', 'currentPeriodEnd', 'gracePeriodEnd']) if (subscription[key] !== undefined) safePayload[`subscription.${key}`] = subscription[key]
  }
  if (!Object.keys(safePayload).length) throw new ApiError(httpStatus.BAD_REQUEST, 'No supported platform fields supplied')
  const result = await Organization.findByIdAndUpdate(id, { $set: safePayload }, { new: true })
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  return result
}

export const OrganizationService = {
  createOrganization,
  getMyOrganization,
  getOrganizationByDomain,
  getPublicSiteInfo,
  updateWebsiteSettings,
  updateBrandingSettings,
  updateMyOrganization,
  saveOnboarding,
  completeOnboarding: (organizationId: string) => finalizeOnboarding(organizationId, 'completed'),
  skipOnboarding: (organizationId: string) => finalizeOnboarding(organizationId, 'skipped'),
  getAllOrganizations,
  updateOrganizationBySuperAdmin,
}
