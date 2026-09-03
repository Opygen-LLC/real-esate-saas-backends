import { randomUUID } from 'crypto'
import { performance } from 'perf_hooks'
import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import { Cache } from '../../../shared/cache'
import { emitProductionEvent } from '../../../shared/productionEvents'
import paginationHelper from '../../helpers/paginationHelper'
import { buildTenantWebsiteUrl } from '../../helpers/publicWebsiteUrl'
import { normalizeSubdomain, RESERVED_SUBDOMAINS } from '../../helpers/identity'
import { assertSafeUrl, sanitizeRichText } from '../../helpers/sanitize'
import { safeRegexPattern } from '../../helpers/searchQuery'
import { DomainRecord } from '../domain/domain.model'
import { SubdomainAlias } from '../domain/subdomainAlias.model'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { TemplateRegistry } from '../websiteBuilder/templateRegistry'
import { ComponentRegistry } from '../websiteBuilder/componentRegistry'
import { ObjectStorageService } from '../websiteBuilder/objectStorage.service'
import { WebsitePublicationService } from '../websiteBuilder/websitePublication.service'
import { WebsiteArchitectureService } from '../websiteBuilder/websiteArchitecture.service'
import type { WebsiteRenderMode } from '../websiteBuilder/websiteArchitecture.contract'
import { TenantAccessService } from '../tenantAccess/tenantAccess.service'
import type { EffectiveTenantAccess } from '../tenantAccess/tenantAccess.types'
import { Property } from '../property/property.model'
import { User } from '../user/user.model'
import { IOrganization, IOrganizationFilter, OnboardingStatus } from './organization.interface'
import type { OrganizationSocialLinks, OrganizationWebsiteSettings, PublicOrganizationWebsite } from './organizationWebsite.contract'
import { Organization } from './organization.model'
import { ONBOARDING_TOTAL_STEPS, ONBOARDING_VERSION, normalizeOnboardingState, normalizeOnboardingStep } from './onboarding.constants'


const definedEntries = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))

const canonicalSocialLinks = (value?: OrganizationSocialLinks | null): Omit<OrganizationSocialLinks, 'twitter'> => {
  const links = value || {}
  return definedEntries({
    facebook: links.facebook,
    instagram: links.instagram,
    youtube: links.youtube,
    x: links.x || links.twitter,
    whatsapp: links.whatsapp,
    linkedin: links.linkedin,
  }) as Omit<OrganizationSocialLinks, 'twitter'>
}

const appendSocialLinkUpdates = (
  target: Record<string, unknown>,
  value?: OrganizationSocialLinks | null,
  unset?: Record<string, ''>,
) => {
  if (!value) return
  const canonical: Record<string, unknown> = {
    facebook: value.facebook,
    instagram: value.instagram,
    youtube: value.youtube,
    x: value.x !== undefined ? value.x : value.twitter,
    whatsapp: value.whatsapp,
    linkedin: value.linkedin,
  }
  for (const [key, entry] of Object.entries(canonical)) {
    if (entry === undefined) continue
    target[`socialLinks.${key}`] = key === 'whatsapp' || entry === '' ? entry : assertSafeUrl(String(entry))
  }
  // The migration preserves legacy Twitter during the compatibility window, but
  // an explicit X/Twitter write becomes authoritative and retires the old field.
  if (unset && (value.x !== undefined || value.twitter !== undefined)) unset['socialLinks.twitter'] = ''
}

const mongoUpdate = (set: Record<string, unknown>, unset: Record<string, ''>) => ({
  $set: set,
  ...(Object.keys(unset).length ? { $unset: unset } : {}),
})

const canonicalWebsiteSettings = (settings?: OrganizationWebsiteSettings | null): OrganizationWebsiteSettings => ({
  ...(settings || {}),
  renderMode: settings?.renderMode || 'template',
  sectionStyles: WebsiteArchitectureService.canonicalizeSectionStyles((settings as any)?.sectionStyles),
  websiteDesign: WebsiteArchitectureService.canonicalizeWebsiteDesign((settings as any)?.websiteDesign),
  footer: {
    showSocialLinks: settings?.footer?.showSocialLinks ?? true,
    socialVisibility: {
      facebook: settings?.footer?.socialVisibility?.facebook ?? true,
      instagram: settings?.footer?.socialVisibility?.instagram ?? true,
      youtube: settings?.footer?.socialVisibility?.youtube ?? true,
      x: settings?.footer?.socialVisibility?.x ?? true,
    },
  },
})

const appendWebsiteSettingUpdates = (target: Record<string, unknown>, settings?: OrganizationWebsiteSettings | null) => {
  if (!settings) return
  for (const key of ['heroTitle', 'heroSubtitle', 'heroImage', 'featuredPropertiesCount', 'enableTestimonials', 'enableLeadForm', 'enableWhatsAppChat', 'renderMode', 'content'] as const) {
    const value = settings[key]
    if (value !== undefined) target[`websiteSettings.${key}`] = key === 'heroImage' && value ? assertSafeUrl(String(value)) : value
  }
  if (settings.sectionStyles !== undefined) target['websiteSettings.sectionStyles'] = WebsiteArchitectureService.serializeSectionStylesForStorage(settings.sectionStyles)
  const websiteDesign = (settings as any).websiteDesign
  if (websiteDesign !== undefined) {
    target['websiteSettings.websiteDesign.schemaVersion'] = 1
    if (websiteDesign.componentOverrides !== undefined) {
      target['websiteSettings.websiteDesign.componentOverrides'] = WebsiteArchitectureService.canonicalizeComponentOverrides(websiteDesign.componentOverrides)
    }
    if (websiteDesign.componentAnimations !== undefined) {
      target['websiteSettings.websiteDesign.componentAnimations'] = WebsiteArchitectureService.canonicalizeComponentAnimations(websiteDesign.componentAnimations)
    }
    if (websiteDesign.animationsEnabled !== undefined) {
      target['websiteSettings.websiteDesign.animationsEnabled'] = websiteDesign.animationsEnabled !== false
    }
  }
  if (settings.footer?.showSocialLinks !== undefined) target['websiteSettings.footer.showSocialLinks'] = settings.footer.showSocialLinks
  const visibility = settings.footer?.socialVisibility
  if (visibility) {
    for (const key of ['facebook', 'instagram', 'youtube', 'x'] as const) {
      if (visibility[key] !== undefined) target[`websiteSettings.footer.socialVisibility.${key}`] = visibility[key]
    }
  }
}



const generatedSubdomainForOrganization = (organizationId: string, agencyName?: string): string => {
  const normalizedAgency = normalizeSubdomain(String(agencyName || 'agency'))
  const seed = (normalizedAgency || 'agency').slice(0, 40)
  const safeSeed = RESERVED_SUBDOMAINS.has(seed) ? `agency-${seed}` : seed
  const suffix = organizationId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-10)
  return `${safeSeed}-${suffix || randomUUID().replace(/-/g, '').slice(0, 10)}`.slice(0, 63).replace(/-+$/g, '')
}

const resolveInitialSubdomain = async (organizationId: string, payload: Partial<IOrganization>): Promise<string> => {
  const requested = String(payload.sub_domain || '').trim()
  if (requested) {
    const normalized = normalizeSubdomain(requested)
    if (normalized.length < 2 || RESERVED_SUBDOMAINS.has(normalized)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid or reserved website address')
    }
    const [existing, alias] = await Promise.all([
      Organization.exists({ sub_domain: normalized }),
      SubdomainAlias.exists({ alias: normalized }),
    ])
    if (existing || alias) throw new ApiError(httpStatus.CONFLICT, 'This website address is already taken')
    return normalized
  }

  const isSubdomainAvailable = async (candidate: string) => {
    const [organization, alias] = await Promise.all([
      Organization.exists({ sub_domain: candidate }),
      SubdomainAlias.exists({ alias: candidate }),
    ])
    return !organization && !alias
  }

  const base = generatedSubdomainForOrganization(organizationId, payload.agencyName)
  if (await isSubdomainAvailable(base)) return base
  for (let attempt = 2; attempt <= 99; attempt += 1) {
    const suffix = `-${attempt}`
    const candidate = `${base.slice(0, 63 - suffix.length)}${suffix}`
    if (await isSubdomainAvailable(candidate)) return candidate
  }
  throw new ApiError(httpStatus.CONFLICT, 'Unable to allocate a unique website address')
}

const createOrganization = async (payload: Partial<IOrganization>): Promise<IOrganization> => {
  const organizationId = payload.organizationId || `org_${randomUUID()}`
  if (await Organization.exists({ organizationId })) throw new ApiError(httpStatus.BAD_REQUEST, 'Organization ID already exists')

  // New records persist the canonical X field only. Legacy `twitter` remains read-compatible
  // through canonicalSocialLinks while the production migration window is open.
  const socialLinks = payload.socialLinks ? canonicalSocialLinks(payload.socialLinks) : undefined
  const sub_domain = await resolveInitialSubdomain(organizationId, payload)
  try {
    return await Organization.create({ ...payload, organizationId, sub_domain, ...(socialLinks ? { socialLinks } : {}) })
  } catch (error: any) {
    if (error?.code === 11000 && (error?.keyPattern?.sub_domain || error?.keyValue?.sub_domain)) {
      throw new ApiError(httpStatus.CONFLICT, 'This website address is already taken')
    }
    throw error
  }
}

const getMyOrganization = async (organizationId: string): Promise<(IOrganization & { effectiveAccess: EffectiveTenantAccess }) | null> => {
  const [result, verifiedDomain] = await Promise.all([
    Organization.findOne({ organizationId }).lean(),
    DomainRecord.findOne({ organizationId, entitlementStatus: { $ne: 'suspended' }, status: 'verified', tlsStatus: 'active' }).select('domain').lean(),
  ])
  if (!result) return null
  const effectiveAccess = TenantAccessService.evaluateOrganization(result)
  return {
    ...result,
    socialLinks: canonicalSocialLinks(result.socialLinks),
    websiteSettings: canonicalWebsiteSettings(result.websiteSettings),
    websiteStatus: result.websiteStatus || 'published',
    onboarding: normalizeOnboardingState(result.onboarding, result.createdAt || new Date()),
    websiteUrl: buildTenantWebsiteUrl(result.sub_domain || result.organizationId, verifiedDomain?.domain),
    effectiveAccess,
  } as IOrganization & { effectiveAccess: EffectiveTenantAccess }
}

const getOrganizationByDomain = async (domainOrSubdomain: string): Promise<PublicOrganizationWebsite> =>
  getPublicSiteInfo(domainOrSubdomain)

const getPublicSiteInfo = async (identifier: string): Promise<PublicOrganizationWebsite> => {
  const startedAt = performance.now()
  let mongoMs = 0
  let redisMs = 0
  let queryCount = 0
  const measureMongo = async <T>(work: () => PromiseLike<T>, count = 1): Promise<T> => {
    const started = performance.now()
    try { return await work() }
    finally {
      mongoMs += performance.now() - started
      queryCount += Math.max(0, Math.trunc(count))
    }
  }
  const measureRedis = async <T>(work: () => PromiseLike<T>): Promise<T> => {
    const started = performance.now()
    try { return await work() }
    finally { redisMs += performance.now() - started }
  }
  const finishProfile = (organizationId: string, cacheHit: boolean, resultCount = 1) => {
    const durationMs = performance.now() - startedAt
    const sampleRate = Math.max(0, Math.min(1, Number(process.env.PUBLIC_SITE_PROFILE_SAMPLE_RATE || 0.05)))
    // Cache misses are always useful to profile; fast cache hits are sampled to
    // keep high-traffic public sites from turning performance telemetry into log noise.
    if (cacheHit && durationMs < 150 && Math.random() >= sampleRate) return
    const renderMs = Math.max(0, durationMs - mongoMs - redisMs)
    emitProductionEvent('public_site_query_performance', {
      route: '/public/site/:identifier',
      organizationId,
      cacheHit,
      cacheMiss: !cacheHit,
      durationMs: Number(durationMs.toFixed(1)),
      mongoMs: Number(mongoMs.toFixed(1)),
      redisMs: Number(redisMs.toFixed(1)),
      renderMs: Number(renderMs.toFixed(1)),
      queryCount,
      resultCount,
    }, durationMs >= 150 ? 'warn' : 'info')
  }

  const cacheKey = identifier.toLowerCase().trim()
  const cached = await measureRedis(() => Cache.tenantPublic.get<PublicOrganizationWebsite & { socialLinks?: OrganizationSocialLinks }>(cacheKey))
  if (cached?.organizationId) {
    await TenantAccessService.assertPublicWebsiteAccess(String(cached.organizationId))
    finishProfile(String(cached.organizationId), true)
    const websiteSettings = canonicalWebsiteSettings(cached.websiteSettings)
    const normalizedCached = { ...cached, socialLinks: canonicalSocialLinks(cached.socialLinks), websiteSettings }
    return {
      ...normalizedCached,
      website: cached.website || WebsiteArchitectureService.toCanonicalWebsiteContract(normalizedCached, {
        renderMode: websiteSettings.renderMode === 'builder' ? 'builder' : 'template',
        templateId: normalizedCached.templateId || 'template-1',
        customDomain: normalizedCached.domain || '',
        customDomainVerified: false,
        public: true,
      }),
    }
  }

  const publicSelect = 'organizationId agencyName agencyType licenseNumber email phone address city state country zipCode defaultLanguage addressDetails areaConversion serviceAreas logo favicon primaryColor secondaryColor metaTitle metaDescription sub_domain domain domain_Verify templateId font socialLinks websiteSettings websiteStatus entitlementRestrictions updatedAt'
  let org: any = await measureMongo(() => Organization.findOne({ $or: [{ sub_domain: cacheKey }, { organizationId: identifier }] })
    .select(publicSelect)
    .lean())

  if (!org) {
    const alias: any = await measureMongo(() => SubdomainAlias.findOne({ alias: cacheKey }).lean())
    if (alias) {
      org = await measureMongo(() => Organization.findOne({ organizationId: alias.organizationId })
        .select(publicSelect)
        .lean())
    }
  }

  if (!org) {
    const normalized = cacheKey.replace(/^www\./, '').split(':')[0]
    const resolved = await measureRedis(() => Cache.tenantResolve.get(normalized))
    const verifiedDomain: any = resolved || await measureMongo(() => DomainRecord.findOne({ domain: normalized, entitlementStatus: { $ne: 'suspended' }, status: 'verified', tlsStatus: 'active' }).select('organizationId').lean())
    if (verifiedDomain?.organizationId) {
      if (!resolved) await measureRedis(() => Cache.tenantResolve.set(normalized, verifiedDomain.organizationId))
      org = await measureMongo(() => Organization.findOne({ organizationId: verifiedDomain.organizationId })
        .select(publicSelect)
        .lean())
    }
  }

  if (!org) {
    finishProfile('', false, 0)
    throw new ApiError(httpStatus.NOT_FOUND, 'Agency website is not published')
  }
  await TenantAccessService.assertPublicWebsiteAccess(String(org.organizationId))

  const [totalProperties, totalAgents] = await measureMongo(() => Promise.all([
    Property.countDocuments({ organizationId: org.organizationId, status: 'Available', quotaLocked: { $ne: true } }),
    User.countDocuments({ organizationId: org.organizationId, userRole: { $in: ['agent', 'agency_admin', 'agency_owner', 'admin'] } }),
  ]), 2)
  // Keep entitlement/runtime bookkeeping available for response shaping without
  // exposing those internal fields through either public organization endpoint.
  const { entitlementRestrictions, updatedAt, domain_Verify, ...publicOrg } = org
  const effectiveTemplateId = entitlementRestrictions?.premiumTemplates && TemplateRegistry.isPremium(String(org.templateId || '')) ? 'template-1' : (org.templateId || 'template-1')
  const websiteSettings = canonicalWebsiteSettings(org.websiteSettings)
  const result: PublicOrganizationWebsite = {
    ...publicOrg,
    socialLinks: canonicalSocialLinks(org.socialLinks),
    defaultLanguage: org.defaultLanguage || 'en',
    metaTitle: org.metaTitle || `${org.agencyName} | Real Estate in Bangladesh`,
    metaDescription: org.metaDescription || `Browse verified real estate properties with ${org.agencyName}.`,
    templateId: effectiveTemplateId,
    configuredTemplateId: org.templateId || 'template-1',
    font: org.font || 'Inter',
    primaryColor: org.primaryColor || '#1877F2',
    secondaryColor: org.secondaryColor || '#0f172a',
    websiteSettings,
    website: WebsiteArchitectureService.toCanonicalWebsiteContract({ ...org, websiteSettings }, {
      renderMode: websiteSettings.renderMode === 'builder' ? 'builder' : 'template',
      templateId: effectiveTemplateId,
      customDomain: entitlementRestrictions?.customDomain ? '' : String(org.domain || ''),
      customDomainVerified: Boolean(domain_Verify) && !entitlementRestrictions?.customDomain,
      public: true,
    }),
    brandingVersion: updatedAt ? new Date(updatedAt).toISOString() : '',
    stats: { totalProperties, totalAgents },
  }
  const identifiers = [
    cacheKey,
    org.organizationId,
    org.sub_domain,
    ...(entitlementRestrictions?.customDomain ? [] : [org.domain]),
  ].filter(Boolean).map(String)
  await measureRedis(() => Promise.all(identifiers.map((key) => Cache.tenantPublic.set(key, result, 300))).then(() => undefined))
  await measureRedis(() => Promise.all(identifiers.map((key) => Cache.tenantResolve.set(key, org.organizationId, 300))).then(() => undefined))
  finishProfile(String(org.organizationId), false)
  return result
}

const updateWebsiteSettings = async (organizationId: string, payload: Partial<IOrganization>): Promise<IOrganization | null> => {
  if (payload.templateId) await TemplateRegistry.assertEntitlement(organizationId, { template: { id: payload.templateId } })
  if (payload.websiteSettings?.websiteDesign?.componentOverrides) {
    await ComponentRegistry.assertOverrides(organizationId, payload.websiteSettings.websiteDesign.componentOverrides)
  }
  const currentWebsite = await Organization.findOne({ organizationId }).select('templateId websiteSettings.renderMode').lean()
  if (!currentWebsite) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  const requestedRenderMode = payload.websiteSettings?.renderMode
  const renderMode: WebsiteRenderMode = requestedRenderMode === 'builder' || requestedRenderMode === 'template'
    ? requestedRenderMode
    : payload.templateId
      ? 'template'
      : currentWebsite.websiteSettings?.renderMode === 'builder'
        ? 'builder'
        : 'template'

  const updateData: Record<string, unknown> = definedEntries({
    primaryColor: payload.primaryColor,
    secondaryColor: payload.secondaryColor,
    metaTitle: payload.metaTitle,
    metaDescription: payload.metaDescription ? sanitizeRichText(payload.metaDescription) : payload.metaDescription,
    logo: payload.logo ? assertSafeUrl(payload.logo) : payload.logo,
    defaultLanguage: payload.defaultLanguage,
    templateId: payload.templateId,
    font: payload.font,
  })

  const unsetData: Record<string, ''> = {}
  appendSocialLinkUpdates(updateData, payload.socialLinks, unsetData)
  appendWebsiteSettingUpdates(updateData, payload.websiteSettings)
  if (payload.templateId) updateData['websiteSettings.renderMode'] = 'template'

  const publication = await WebsitePublicationService.commitPublicationState({
    organizationId,
    renderMode,
    set: updateData,
    unset: unsetData,
  })
  const result = publication.organization
  await WebsitePublicationService.afterPublication({
    organizationId,
    renderMode,
    aggregateId: result._id.toString(),
    publicationRevision: publication.publicationRevision,
    eventType: renderMode === 'builder' ? 'website.settings_published' : 'website.template_published',
  })
  await DomainEventService.emit({ organizationId, aggregateType: 'organization', aggregateId: result._id.toString(), eventType: 'organization.website_updated', payload: { fields: Object.keys(updateData), publicationRevision: publication.publicationRevision } })
  if (payload.templateId && String(currentWebsite?.templateId || 'template-1') !== String(payload.templateId)) {
    emitProductionEvent('website_template_changed', {
      organizationId,
      fromTemplateId: String(currentWebsite?.templateId || 'template-1'),
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
  const current = await Organization.findOne({ organizationId }).select('websiteSettings.renderMode').lean()
  if (!current) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  const renderMode: WebsiteRenderMode = current.websiteSettings?.renderMode === 'builder' ? 'builder' : 'template'
  const publication = await WebsitePublicationService.commitPublicationState({ organizationId, renderMode, set: updateData })
  const result = publication.organization
  const tenantIdentifiers = await WebsitePublicationService.afterPublication({
    organizationId,
    renderMode,
    aggregateId: result._id.toString(),
    publicationRevision: publication.publicationRevision,
    eventType: 'website.branding_published',
  })
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
      publicationRevision: publication.publicationRevision,
    },
  })
  return result
}

const updateInvoiceBrandingSettings = async (organizationId: string, payload: Pick<IOrganization, 'invoiceLogo'>): Promise<IOrganization> => {
  const invoiceLogo = String(payload.invoiceLogo || '').trim()
  let safeInvoiceLogo = ''

  if (invoiceLogo) {
    safeInvoiceLogo = assertSafeUrl(invoiceLogo)
    const key = ObjectStorageService.keyFromReference(safeInvoiceLogo)
    if (!key || !key.startsWith(`tenants/${organizationId}/`)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invoice logo must be uploaded to this agency storage first')
    }
    const metadata = await ObjectStorageService.head(key)
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
    if (!allowedTypes.has(metadata.contentType.toLowerCase())) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invoice logo must be a JPG, PNG, WebP, or AVIF image')
    }
    if (metadata.size > 5 * 1024 * 1024) {
      throw new ApiError(413, 'Invoice logo must be 5 MB or smaller')
    }
  }

  const result = await Organization.findOneAndUpdate(
    { organizationId },
    { $set: { invoiceLogo: safeInvoiceLogo } },
    { new: true },
  )
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')

  await CacheInvalidationService.invalidateTenant(organizationId)
  await DomainEventService.emit({
    organizationId,
    aggregateType: 'organization',
    aggregateId: result._id.toString(),
    eventType: 'finance.invoice_branding_updated',
    payload: { invoiceLogoConfigured: Boolean(safeInvoiceLogo) },
  })
  return result
}

const updateMyOrganization = async (organizationId: string, payload: Partial<IOrganization>): Promise<IOrganization | null> => {
  const allowed = ['agencyName', 'agencyType', 'email', 'phone', 'licenseNumber', 'address', 'city', 'state', 'country', 'zipCode', 'defaultLanguage', 'addressDetails', 'areaConversion', 'serviceAreas', 'teamSettings'] as const
  const safePayload: Record<string, unknown> = Object.fromEntries(allowed.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]))
  const unsetData: Record<string, ''> = {}
  appendSocialLinkUpdates(safePayload, payload.socialLinks, unsetData)
  const result = await Organization.findOneAndUpdate({ organizationId }, mongoUpdate(safePayload, unsetData), { new: true })
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
    'onboarding.status': 'in_progress',
    'onboarding.currentStep': currentStep,
    'onboarding.version': ONBOARDING_VERSION,
  })
  const unsetData: Record<string, ''> = {}
  appendSocialLinkUpdates(update, payload.socialLinks, unsetData)
  appendWebsiteSettingUpdates(update, payload.websiteSettings)

  const result = await Organization.findOneAndUpdate({ organizationId }, mongoUpdate(update, unsetData), { new: true })
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
  if (searchTerm) {
    const search = safeRegexPattern(searchTerm)
    andConditions.push({ $or: ['agencyName', 'email', 'phone', 'city', 'organizationId'].map((field) => ({ [field]: { $regex: search, $options: 'i' } })) })
  }
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
  updateInvoiceBrandingSettings,
  updateMyOrganization,
  saveOnboarding,
  completeOnboarding: (organizationId: string) => finalizeOnboarding(organizationId, 'completed'),
  skipOnboarding: (organizationId: string) => finalizeOnboarding(organizationId, 'skipped'),
  getAllOrganizations,
  updateOrganizationBySuperAdmin,
}
