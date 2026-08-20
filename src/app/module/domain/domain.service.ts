import dns from 'dns/promises'
import { randomBytes } from 'crypto'
import { domainToASCII } from 'url'
import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import config from '../../../config'
import { Organization } from '../organization/organization.model'
import { DomainRecord, DOMAIN_LIFECYCLE_STATUSES, type DomainLifecycleStatus } from './domain.model'
import { EntitlementService } from '../entitlement/entitlement.service'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { normalizeSubdomain, RESERVED_SUBDOMAINS } from '../../helpers/identity'
import { buildTenantWebsiteUrl } from '../../helpers/publicWebsiteUrl'
import { SubdomainAlias } from './subdomainAlias.model'
import { DomainProviderService, type DomainDiagnostic } from './providers'

const ACTIVE_RECHECK_MS = 6 * 60 * 60_000
const TLS_RECHECK_MS = 2 * 60_000
const DNS_RECHECK_MS = 5 * 60_000

const normalizeDomain = (input: string): string => {
  const candidate = String(input || '').trim().toLowerCase()
  if (!candidate || candidate.includes('://') || /[/?#]/.test(candidate) || candidate.includes(':') || candidate.startsWith('*.')) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Enter a bare domain name without protocol, path, port or wildcard')
  }
  const raw = candidate.replace(/\.$/, '')
  const withoutWww = raw.startsWith('www.') ? raw.slice(4) : raw
  const ascii = domainToASCII(withoutWww)
  if (!ascii || ascii.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(ascii)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Enter a valid registrable domain name')
  }
  return ascii
}

const requestedHost = (input: string) => String(input || '').trim().toLowerCase().split(':')[0].replace(/\.$/, '')

const deriveLifecycle = (record: any): DomainLifecycleStatus => {
  // Legacy Phase 8 records can receive the schema default when hydrated even
  // though lifecycleStatus was never persisted, so a verified legacy record
  // takes precedence over the default PENDING_DNS value.
  if (record?.status === 'verified' && record?.tlsStatus === 'active') return 'ACTIVE'
  if (record?.status === 'verified' && record?.lifecycleStatus === 'PENDING_DNS') return 'TLS_PROVISIONING'
  if (DOMAIN_LIFECYCLE_STATUSES.includes(record?.lifecycleStatus)) return record.lifecycleStatus
  if (record?.status === 'verified') return 'TLS_PROVISIONING'
  return 'PENDING_DNS'
}

const normalizeTenantSubdomain = (input: string): string => {
  const value = normalizeSubdomain(input)
  if (value.length < 2) throw new ApiError(httpStatus.BAD_REQUEST, 'Website address must contain at least 2 letters or numbers')
  if (RESERVED_SUBDOMAINS.has(value)) throw new ApiError(httpStatus.BAD_REQUEST, 'This website address is reserved')
  return value
}

const isSubdomainAvailable = async (input: string, organizationId?: string) => {
  const subdomain = normalizeTenantSubdomain(input)
  const [organization, alias] = await Promise.all([
    Organization.findOne({ sub_domain: subdomain }).select('organizationId').lean(),
    SubdomainAlias.findOne({ alias: subdomain }).select('organizationId').lean(),
  ])
  const occupiedByOther = Boolean(
    (organization && organization.organizationId !== organizationId)
    || (alias && alias.organizationId !== organizationId),
  )
  return { subdomain, available: !occupiedByOther, websiteUrl: buildTenantWebsiteUrl(subdomain) }
}

const changeSubdomain = async (organizationId: string, input: string) => {
  const subdomain = normalizeTenantSubdomain(input)
  const org = await Organization.findOne({ organizationId }).select('agencyName sub_domain websiteStatus isBlocked').lean()
  if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found')
  const previousSubdomain = String(org.sub_domain || '')
  if (previousSubdomain === subdomain) return { subdomain, previousSubdomain, websiteUrl: buildTenantWebsiteUrl(subdomain) }

  const availability = await isSubdomainAvailable(subdomain, organizationId)
  if (!availability.available) throw new ApiError(httpStatus.CONFLICT, 'This website address is already taken')

  try {
    await Organization.updateOne({ organizationId, sub_domain: previousSubdomain }, { $set: { sub_domain: subdomain } })
    if (previousSubdomain) {
      await SubdomainAlias.findOneAndUpdate(
        { alias: previousSubdomain },
        { $set: { organizationId, canonicalSubdomain: subdomain } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
    }
    await SubdomainAlias.deleteOne({ alias: subdomain, organizationId })
    await SubdomainAlias.updateMany({ organizationId }, { $set: { canonicalSubdomain: subdomain } })
  } catch (error: any) {
    if (error?.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'This website address is already taken')
    throw error
  }

  await CacheInvalidationService.invalidateTenant(organizationId)
  return { subdomain, previousSubdomain, websiteUrl: buildTenantWebsiteUrl(subdomain) }
}

const resolveSubdomain = async (input: string) => {
  const subdomain = normalizeSubdomain(input)
  if (!subdomain) return null
  const direct = await Organization.findOne({ sub_domain: subdomain }).select('organizationId agencyName sub_domain websiteStatus isBlocked').lean()
  if (direct) return {
    organizationId: direct.organizationId,
    agencyName: direct.agencyName,
    canonicalSubdomain: direct.sub_domain,
    isAlias: false,
    websiteStatus: direct.isBlocked ? 'suspended' : (direct.websiteStatus || 'published'),
    websiteUrl: buildTenantWebsiteUrl(direct.sub_domain || direct.organizationId),
  }
  const alias = await SubdomainAlias.findOne({ alias: subdomain }).lean()
  if (!alias) return null
  const canonical = await Organization.findOne({ organizationId: alias.organizationId }).select('agencyName sub_domain websiteStatus isBlocked').lean()
  if (!canonical) return null
  return {
    organizationId: alias.organizationId,
    agencyName: canonical.agencyName,
    canonicalSubdomain: canonical.sub_domain || alias.canonicalSubdomain,
    isAlias: true,
    websiteStatus: canonical.isBlocked ? 'suspended' : (canonical.websiteStatus || 'published'),
    websiteUrl: buildTenantWebsiteUrl(canonical.sub_domain || alias.canonicalSubdomain),
  }
}

const resolveTxt = async (name: string) => {
  try { return (await dns.resolveTxt(name)).flat() } catch { return [] }
}

const ownershipDiagnostic = async (record: any): Promise<DomainDiagnostic> => {
  const txtName = `${config.domains.ownership_prefix}.${record.domain}`
  const observed = await resolveTxt(txtName)
  const expected = `realestate-saas=${record.ownershipToken}`
  const ok = observed.includes(expected)
  return {
    check: 'ownership_txt',
    label: 'Ownership TXT',
    state: ok ? 'pass' : 'pending',
    ok,
    expected,
    observed,
    checkedAt: new Date(),
  }
}

const publicDomainStatus = (record: any) => {
  if (!record) return null
  const source = typeof record.toObject === 'function' ? record.toObject() : record
  const lifecycleStatus = deriveLifecycle(source)
  return {
    ...source,
    lifecycleStatus,
    canonicalHost: source.domain,
    provider: source.provider || config.domains.provider,
    failureReason: source.failureReason || '',
  }
}

const add = async (organizationId: string, input: string) => {
  await EntitlementService.assertFeature(organizationId, 'customDomain')
  const domain = normalizeDomain(input)
  const conflicting = await DomainRecord.findOne({ domain })
  if (conflicting && conflicting.organizationId !== organizationId) throw new ApiError(409, 'This domain is already attached to another agency')

  const current: any = await DomainRecord.findOne({ organizationId })
  if (current?.domain === domain) return publicDomainStatus(current)

  const ownershipToken = current?.ownershipToken || randomBytes(24).toString('base64url')
  const provider = DomainProviderService.current()
  const providerRegistration = await provider.registerDomain({ domain, organizationId, ownershipToken })
  const dnsRecords = await provider.getRequiredDns({ domain, organizationId, ownershipToken })

  let record: any
  try {
    record = await DomainRecord.findOneAndUpdate(
      { organizationId },
      {
        $set: {
          domain,
          ownershipToken,
          entitlementStatus: 'active',
          entitlementSuspendedAt: null,
          entitlementSuspendedReason: '',
          provider: provider.name,
          lifecycleStatus: 'PENDING_DNS',
          providerRegistrationStatus: providerRegistration.registered ? 'registered' : 'pending',
          providerRegisteredAt: providerRegistration.registered ? new Date() : null,
          publicRoutingStatus: 'pending',
          status: 'pending',
          tlsStatus: 'not_started',
          providerRequestId: providerRegistration.providerRequestId || '',
          requiredDns: dnsRecords,
          diagnostics: [],
          failureReason: '',
          failureCount: 0,
          lastCheckedAt: null,
          nextCheckAt: new Date(),
          ownershipVerifiedAt: null,
          routingVerifiedAt: null,
          tlsActiveAt: null,
          activeAt: null,
          verifiedAt: null,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )
  } catch (error: any) {
    if (error?.code === 11000) throw new ApiError(409, 'This domain is already attached to another agency')
    throw error
  }
  if (!record) throw new ApiError(500, 'Failed to persist custom domain configuration')

  await Organization.updateOne({ organizationId }, { $set: { domain, domain_Verify: false, domain_dns: dnsRecords } })
  await CacheInvalidationService.invalidateTenant(organizationId)

  if (current?.domain && current.domain !== domain) {
    // The new domain is already registered before the old one is removed, so a
    // provider outage cannot destroy the currently configured hostname first.
    await provider.removeDomain(current.domain).catch(() => undefined)
  }
  return publicDomainStatus(record)
}

const verifyRecord = async (record: any) => {
  const provider = DomainProviderService.current()
  const now = new Date()
  const input = { domain: record.domain, organizationId: record.organizationId, ownershipToken: record.ownershipToken }
  const ownership = await ownershipDiagnostic(record)
  try {
    record.requiredDns = await provider.getRequiredDns(input)
  } catch {
    // Provider health/routing checks below will surface the outage. Retain the
    // last-known DNS instructions so the dashboard remains useful meanwhile.
  }

  let routing
  try {
    routing = await provider.verifyRouting(input)
  } catch (error) {
    routing = {
      apexOk: false,
      wwwOk: false,
      registered: false,
      providerVerified: false,
      diagnostics: [{
        check: 'hosting_registration',
        label: 'Hosting registration',
        state: 'failed',
        ok: false,
        expected: provider.name,
        observed: null,
        message: error instanceof Error ? error.message : 'Hosting provider unavailable',
        checkedAt: now,
      } satisfies DomainDiagnostic],
    }
  }

  // Re-register idempotently if a provider-side domain was removed after the
  // database record was created.
  if (ownership.ok && routing.apexOk && routing.wwwOk && !routing.registered) {
    try {
      const registration = await provider.registerDomain(input)
      if (registration.registered) {
        record.providerRegistrationStatus = 'registered'
        record.providerRegisteredAt = record.providerRegisteredAt || now
        try { record.requiredDns = await provider.getRequiredDns(input) } catch { /* preserve last-known instructions */ }
        routing = await provider.verifyRouting(input)
      }
    } catch (error) {
      record.providerRegistrationStatus = 'failed'
      routing.diagnostics = [...routing.diagnostics, {
        check: 'hosting_registration',
        label: 'Hosting registration',
        state: 'failed',
        ok: false,
        expected: provider.name,
        observed: null,
        message: error instanceof Error ? error.message : 'Hosting registration failed',
        checkedAt: now,
      }]
    }
  }

  const routingOk = routing.apexOk && routing.wwwOk && routing.registered && routing.providerVerified
  let lifecycleStatus: DomainLifecycleStatus = !ownership.ok
    ? 'PENDING_DNS'
    : !routingOk
      ? 'OWNERSHIP_VERIFIED'
      : 'ROUTING_VERIFIED'

  let tlsStatus: 'not_started' | 'provisioning' | 'active' | 'failed' = routingOk ? 'provisioning' : 'not_started'
  let tlsDiagnostics: DomainDiagnostic[] = [{
    check: 'tls_certificate',
    label: 'TLS certificate',
    state: 'pending',
    ok: false,
    expected: `${provider.name}-managed TLS`,
    observed: tlsStatus,
    checkedAt: now,
  }]
  let publicRoutingStatus: 'pending' | 'active' | 'failed' = 'pending'
  let publicDiagnostics: DomainDiagnostic[] = [{
    check: 'public_routing',
    label: 'Public routing',
    state: 'pending',
    ok: false,
    expected: 'Opygen website runtime',
    observed: 'waiting_for_tls',
    checkedAt: now,
  }]

  if (routingOk) {
    lifecycleStatus = 'TLS_PROVISIONING'
    const tls = await provider.provisionTls(input)
    tlsStatus = tls.status
    tlsDiagnostics = tls.diagnostics
    if (tls.status === 'active') {
      const publicRouting = await provider.verifyPublicRouting(input)
      publicRoutingStatus = publicRouting.active ? 'active' : 'pending'
      publicDiagnostics = publicRouting.diagnostics
      if (publicRouting.active) lifecycleStatus = 'ACTIVE'
    }
  }

  const diagnostics = [ownership, ...routing.diagnostics, ...tlsDiagnostics, ...publicDiagnostics]
  const failure = diagnostics.find((item) => item.state === 'failed')
  const active = lifecycleStatus === 'ACTIVE' && tlsStatus === 'active' && publicRoutingStatus === 'active'
  const failureReason = failure?.message || ''
  const failureCount = active ? 0 : failure ? Number(record.failureCount || 0) + 1 : Number(record.failureCount || 0)
  const retryMs = active ? ACTIVE_RECHECK_MS : lifecycleStatus === 'TLS_PROVISIONING' ? TLS_RECHECK_MS : DNS_RECHECK_MS

  record.lifecycleStatus = lifecycleStatus
  record.provider = provider.name
  record.providerRegistrationStatus = routing.registered ? 'registered' : (record.providerRegistrationStatus === 'failed' ? 'failed' : 'pending')
  record.providerRegisteredAt = routing.registered ? (record.providerRegisteredAt || now) : record.providerRegisteredAt
  record.publicRoutingStatus = publicRoutingStatus
  record.status = active ? 'verified' : 'pending'
  record.tlsStatus = tlsStatus
  record.diagnostics = diagnostics
  record.failureReason = failureReason
  record.failureCount = failureCount
  record.lastCheckedAt = now
  record.nextCheckAt = new Date(Date.now() + retryMs)
  record.ownershipVerifiedAt = ownership.ok ? (record.ownershipVerifiedAt || now) : null
  record.routingVerifiedAt = routingOk ? (record.routingVerifiedAt || now) : null
  record.tlsActiveAt = tlsStatus === 'active' ? (record.tlsActiveAt || now) : null
  record.activeAt = active ? (record.activeAt || now) : null
  record.verifiedAt = active ? (record.verifiedAt || now) : null
  await record.save()

  await Organization.updateOne(
    { organizationId: record.organizationId },
    { $set: { domain: record.domain, domain_Verify: active, domain_dns: record.requiredDns } },
  )
  await CacheInvalidationService.invalidateTenant(record.organizationId)
  return publicDomainStatus(record)
}

const markLifecycleFailure = async (record: any, error: unknown) => {
  const now = new Date()
  const message = error instanceof Error ? error.message : 'Unknown domain lifecycle failure'
  const failureCount = Number(record.failureCount || 0) + 1
  record.lifecycleStatus = deriveLifecycle(record)
  if (record.lifecycleStatus === 'ACTIVE') record.lifecycleStatus = 'TLS_PROVISIONING'
  record.status = 'pending'
  if (record.tlsStatus === 'active') record.tlsStatus = 'provisioning'
  record.publicRoutingStatus = 'pending'
  record.failureCount = failureCount
  record.failureReason = message.slice(0, 500)
  record.lastCheckedAt = now
  record.diagnostics = [...(record.diagnostics || []), {
    check: 'lifecycle',
    label: 'Lifecycle',
    state: 'failed',
    ok: false,
    message: message.slice(0, 500),
    checkedAt: now,
  }].slice(-20)
  const retryMinutes = Math.min(360, Math.max(5, 2 ** Math.min(failureCount, 8)))
  record.nextCheckAt = new Date(Date.now() + retryMinutes * 60_000)
  await record.save()
  await Organization.updateOne({ organizationId: record.organizationId }, { $set: { domain_Verify: false } })
  await CacheInvalidationService.invalidateTenant(record.organizationId)
}

const verifyById = async (recordId: string) => {
  const record: any = await DomainRecord.findById(recordId)
  if (!record) return null
  if (record.entitlementStatus === 'suspended') return publicDomainStatus(record)
  try { return await verifyRecord(record) }
  catch (error) {
    await markLifecycleFailure(record, error)
    throw error
  }
}

const verify = async (organizationId: string) => {
  await EntitlementService.assertFeature(organizationId, 'customDomain')
  const record: any = await DomainRecord.findOne({ organizationId })
  if (!record) throw new ApiError(404, 'No custom domain is configured')
  try { return await verifyRecord(record) }
  catch (error) {
    await markLifecycleFailure(record, error)
    throw error
  }
}

const get = async (organizationId: string) => {
  const record: any = await DomainRecord.findOne({ organizationId })
  return publicDomainStatus(record)
}

const retryDue = async (limit = 50) => {
  const records = await DomainRecord.find({ entitlementStatus: { $ne: 'suspended' }, nextCheckAt: { $lte: new Date() } }).sort({ nextCheckAt: 1 }).limit(limit)
  let checked = 0
  let failed = 0
  for (const record of records) {
    checked += 1
    try { await verifyRecord(record) }
    catch (error) { failed += 1; await markLifecycleFailure(record, error) }
  }
  return { checked, failed }
}

const resolveVerifiedDomain = async (host: string): Promise<string | null> => {
  const details = await resolveVerifiedHost(host)
  return details?.organizationId || null
}

const resolveVerifiedHost = async (host: string) => {
  const rawHost = requestedHost(host)
  const domain = normalizeDomain(rawHost)
  const record: any = await DomainRecord.findOne({
    domain,
    entitlementStatus: { $ne: 'suspended' },
    tlsStatus: 'active',
    $or: [
      { lifecycleStatus: 'ACTIVE', publicRoutingStatus: 'active' },
      // Rolling-deploy compatibility for a Phase 8 record that was already
      // verified before lifecycleStatus/publicRoutingStatus existed.
      { lifecycleStatus: { $exists: false }, status: 'verified' },
    ],
  }).lean()
  if (!record?.organizationId) return null
  const org: any = await Organization.findOne({ organizationId: record.organizationId }).select('organizationId agencyName sub_domain websiteStatus isBlocked platformAccess.status').lean()
  if (!org) return null
  const canonicalHost = record.domain
  return {
    organizationId: org.organizationId,
    agencyName: org.agencyName,
    canonicalSubdomain: org.sub_domain || org.organizationId,
    canonicalHost,
    redirectTo: rawHost === canonicalHost ? null : `https://${canonicalHost}`,
    lifecycleStatus: deriveLifecycle(record),
    websiteStatus: org.isBlocked ? 'suspended' : (org.websiteStatus || 'published'),
    isBlocked: Boolean(org.isBlocked),
  }
}

export const DomainService = {
  add,
  get,
  verify,
  verifyById,
  retryDue,
  resolveVerifiedDomain,
  resolveVerifiedHost,
  normalizeDomain,
  isSubdomainAvailable,
  changeSubdomain,
  resolveSubdomain,
  publicDomainStatus,
}
