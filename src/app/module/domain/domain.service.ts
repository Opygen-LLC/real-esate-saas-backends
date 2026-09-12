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
import { DomainProviderService, type DomainDiagnostic, type DomainProviderMetadata, type DomainRegistrationResult } from './providers'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'
import { TenantAccessService } from '../tenantAccess/tenantAccess.service'
import { TenantAccessMonitoringService } from '../tenantAccess/tenantAccessMonitoring.service'

const ACTIVE_RECHECK_MS = 6 * 60 * 60_000
const TLS_RECHECK_MS = 2 * 60_000
const DNS_RECHECK_MS = 5 * 60_000
const MIGRATION_RECHECK_MS = 2 * 60_000

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
  const direct = await Organization.findOne({ sub_domain: subdomain }).select('organizationId agencyName sub_domain').lean()
  if (direct) {
    const access = await TenantAccessService.evaluate(direct.organizationId)
    if (!access.publicWebsiteAllowed) TenantAccessMonitoringService.recordPublicDenied(access)
    return {
      organizationId: direct.organizationId,
      agencyName: direct.agencyName,
      canonicalSubdomain: direct.sub_domain,
      isAlias: false,
      websiteStatus: access.websiteStatus,
      publicAccess: TenantAccessService.toPublicAccess(access),
      websiteUrl: buildTenantWebsiteUrl(direct.sub_domain || direct.organizationId),
    }
  }
  const alias = await SubdomainAlias.findOne({ alias: subdomain }).lean()
  if (!alias) return null
  const canonical = await Organization.findOne({ organizationId: alias.organizationId }).select('organizationId agencyName sub_domain').lean()
  if (!canonical) return null
  const access = await TenantAccessService.evaluate(alias.organizationId)
  if (!access.publicWebsiteAllowed) TenantAccessMonitoringService.recordPublicDenied(access)
  return {
    organizationId: alias.organizationId,
    agencyName: canonical.agencyName,
    canonicalSubdomain: canonical.sub_domain || alias.canonicalSubdomain,
    isAlias: true,
    websiteStatus: access.websiteStatus,
    publicAccess: TenantAccessService.toPublicAccess(access),
    websiteUrl: buildTenantWebsiteUrl(canonical.sub_domain || alias.canonicalSubdomain),
  }
}

const resolveTxt = async (name: string) => {
  try { return (await dns.resolveTxt(name)).flat() } catch { return [] }
}

const ownershipDiagnostic = async (record: { domain: string; ownershipToken: string }): Promise<DomainDiagnostic> => {
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

const publicLifecycleSlot = (source: any) => {
  if (!source) return null
  const raw = typeof source.toObject === 'function' ? source.toObject() : source
  const { ownershipToken: _ownershipToken, providerMetadata: _providerMetadata, providerRequestId: _providerRequestId, ...safe } = raw
  return { ...safe, lifecycleStatus: deriveLifecycle(raw) }
}

const publicProviderMigration = (source: any) => {
  if (!source) return null
  const raw = typeof source.toObject === 'function' ? source.toObject() : source
  const target = publicLifecycleSlot(raw.target)
  const legacy = publicLifecycleSlot(raw.legacy)
  return {
    legacyProvider: raw.legacyProvider || legacy?.provider || 'vercel',
    targetProvider: raw.targetProvider || target?.provider || 'cloudflare',
    migrationStatus: raw.migrationStatus || 'NOT_STARTED',
    startedAt: raw.startedAt || null,
    cloudflareRegisteredAt: raw.cloudflareRegisteredAt || null,
    waitingDnsAt: raw.waitingDnsAt || null,
    cloudflareTlsActiveAt: raw.cloudflareTlsActiveAt || null,
    trafficSwitchedAt: raw.trafficSwitchedAt || null,
    rollbackUntil: raw.rollbackUntil || null,
    vercelRemovedAt: raw.vercelRemovedAt || null,
    lastCheckedAt: raw.lastCheckedAt || null,
    nextCheckAt: raw.nextCheckAt || null,
    failureReason: raw.failureReason || '',
    target,
    // Expose the old provider's DNS only during the rollback window. This is
    // intentionally provider-neutral data; provider IDs/metadata stay private.
    rollbackDns: ['TRAFFIC_SWITCHED'].includes(raw.migrationStatus) ? (legacy?.requiredDns || []) : [],
  }
}

const publicDomainStatus = (record: any) => {
  if (!record) return null
  const source = typeof record.toObject === 'function' ? record.toObject() : record
  const { ownershipToken: _ownershipToken, providerMetadata: _providerMetadata, providerRequestId: _providerRequestId, candidate: rawCandidate, providerMigration: rawProviderMigration, ...safe } = source
  const candidate = publicLifecycleSlot(rawCandidate)
  const providerMigration = publicProviderMigration(rawProviderMigration)
  const lifecycleStatus = deriveLifecycle(source)
  return {
    ...safe,
    lifecycleStatus,
    canonicalHost: source.canonicalHost || source.domain,
    activeDomain: lifecycleStatus === 'ACTIVE' && source.tlsStatus === 'active' && source.publicRoutingStatus === 'active' ? (source.canonicalHost || source.domain) : null,
    candidate,
    providerMigration,
    providerMigrationInProgress: Boolean(providerMigration && providerMigration.migrationStatus !== 'VERCEL_REMOVED'),
    replacementInProgress: Boolean(candidate?.domain),
    replacementGraceHours: Math.round(config.domains.replacement_grace_ms / 3_600_000),
    provider: source.provider || config.domains.provider,
    failureReason: source.failureReason || '',
  }
}

const newLifecycleState = (input: {
  domain: string
  ownershipToken: string
  provider: string
  providerRequestId?: string
  providerMetadata?: DomainProviderMetadata
  registered: boolean
  requiredDns: unknown[]
}) => ({
  domain: input.domain,
  canonicalHost: input.domain,
  ownershipToken: input.ownershipToken,
  provider: input.provider,
  lifecycleStatus: 'PENDING_DNS' as DomainLifecycleStatus,
  providerRegistrationStatus: input.registered ? 'registered' : 'pending',
  providerRegisteredAt: input.registered ? new Date() : null,
  publicRoutingStatus: 'pending' as const,
  status: 'pending' as const,
  tlsStatus: 'not_started' as const,
  providerRequestId: input.providerRequestId || '',
  providerMetadata: input.providerMetadata || { hostnames: [] },
  requiredDns: input.requiredDns,
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
})

const snapshotLifecycleState = (source: any) => {
  const raw = typeof source?.toObject === 'function' ? source.toObject() : source
  if (!raw?.domain || !raw?.ownershipToken) return null
  return {
    domain: raw.domain,
    canonicalHost: raw.canonicalHost || raw.domain,
    ownershipToken: raw.ownershipToken,
    provider: raw.provider || config.domains.provider,
    lifecycleStatus: deriveLifecycle(raw),
    providerRegistrationStatus: raw.providerRegistrationStatus || 'pending',
    providerRegisteredAt: raw.providerRegisteredAt || null,
    publicRoutingStatus: raw.publicRoutingStatus || 'pending',
    status: raw.status || 'pending',
    tlsStatus: raw.tlsStatus || 'not_started',
    providerRequestId: raw.providerRequestId || '',
    providerMetadata: raw.providerMetadata?.hostnames ? { hostnames: Array.from(raw.providerMetadata.hostnames) } : { hostnames: [] },
    requiredDns: Array.isArray(raw.requiredDns) ? raw.requiredDns : [],
    diagnostics: Array.isArray(raw.diagnostics) ? raw.diagnostics : [],
    failureReason: raw.failureReason || '',
    failureCount: Number(raw.failureCount || 0),
    lastCheckedAt: raw.lastCheckedAt || null,
    nextCheckAt: raw.nextCheckAt || new Date(),
    ownershipVerifiedAt: raw.ownershipVerifiedAt || null,
    routingVerifiedAt: raw.routingVerifiedAt || null,
    tlsActiveAt: raw.tlsActiveAt || null,
    activeAt: raw.activeAt || null,
    verifiedAt: raw.verifiedAt || null,
  }
}

const applyLifecycleResult = (target: any, result: any) => {
  const fields = [
    'requiredDns', 'canonicalHost', 'lifecycleStatus', 'provider', 'providerRegistrationStatus', 'providerRegisteredAt',
    'providerRequestId', 'providerMetadata',
    'publicRoutingStatus', 'status', 'tlsStatus', 'diagnostics', 'failureReason', 'failureCount',
    'lastCheckedAt', 'nextCheckAt', 'ownershipVerifiedAt', 'routingVerifiedAt', 'tlsActiveAt',
    'activeAt', 'verifiedAt',
  ]
  for (const field of fields) target[field] = result[field]
}

const evaluateLifecycle = async (slot: any, organizationId: string, providerName?: string) => {
  // Existing records stay pinned to their persisted provider. Changing
  // DOMAIN_PROVIDER only affects newly added domains; it must never silently
  // migrate live Vercel traffic to Cloudflare.
  const provider = DomainProviderService.byName(providerName || slot.provider || config.domains.provider)
  const now = new Date()
  const input = { domain: slot.domain, organizationId, ownershipToken: slot.ownershipToken }
  const providerChanged = Boolean(slot.provider && slot.provider !== provider.name)
  const ownership = await ownershipDiagnostic(slot)

  // During a provider change, never keep presenting obsolete routing records.
  // Keep only Opygen's ownership TXT until fresh records from the current
  // provider are available.
  let requiredDns = Array.isArray(slot.requiredDns) ? slot.requiredDns : []
  if (providerChanged) {
    requiredDns = requiredDns.filter((record: any) => record?.purpose === 'ownership' || record?.source === 'opygen_ownership')
  }

  let providerRegistrationStatus: 'pending' | 'registered' | 'failed' = providerChanged
    ? 'pending'
    : (slot.providerRegistrationStatus || 'pending')
  let providerRegisteredAt = providerChanged ? null : slot.providerRegisteredAt
  let providerRequestId = providerChanged ? '' : String(slot.providerRequestId || '')
  let providerMetadata: DomainProviderMetadata = providerChanged
    ? { hostnames: [] }
    : (slot.providerMetadata?.hostnames ? { hostnames: Array.from(slot.providerMetadata.hostnames) } : { hostnames: [] })
  let registrationFailure: string | null = null

  const registerWithCurrentProvider = async () => {
    try {
      const registration = await provider.registerDomain(input)
      if (registration.registered) {
        providerRegistrationStatus = 'registered'
        providerRegisteredAt = providerRegisteredAt || now
        if (registration.providerRequestId) providerRequestId = registration.providerRequestId
        if (registration.providerMetadata) providerMetadata = registration.providerMetadata
        registrationFailure = null
        return true
      }
    } catch (error) {
      providerRegistrationStatus = 'failed'
      registrationFailure = error instanceof Error ? error.message : 'Hosting registration failed'
    }
    return false
  }

  // Provider registration must happen before the customer is asked to change
  // DNS. This also lets existing records migrate to a newly selected provider
  // without requiring the old provider's DNS to match first.
  if (providerChanged || providerRegistrationStatus !== 'registered') {
    await registerWithCurrentProvider()
  }

  try {
    requiredDns = await provider.getRequiredDns(input)
  } catch {
    // Retain last-known records only when they belong to the current provider.
    // During provider cutover, stale routing records were already removed above.
  }

  let canonicalHost = String(slot.canonicalHost || slot.domain)
  let routing
  try {
    routing = await provider.verifyRouting(input)
    if (routing.providerMetadata) providerMetadata = routing.providerMetadata
    if (routing.canonicalHost) canonicalHost = routing.canonicalHost
  } catch (error) {
    routing = {
      apexOk: false,
      wwwOk: false,
      registered: providerRegistrationStatus === 'registered',
      providerVerified: false,
      diagnostics: [{
        check: 'hosting_registration',
        label: 'Hosting registration',
        state: registrationFailure ? 'failed' : 'pending',
        ok: false,
        expected: provider.name,
        observed: null,
        message: registrationFailure || (error instanceof Error ? error.message : 'Hosting provider unavailable'),
        checkedAt: now,
      } satisfies DomainDiagnostic],
    }
  }

  // Self-heal if the hostname was removed from the active hosting provider after
  // it had previously been marked registered. Do not wait for DNS to be correct
  // first; provider registration may be required before verification challenges
  // and managed TLS can be issued.
  if (!routing.registered && !registrationFailure) {
    const registered = await registerWithCurrentProvider()
    if (registered) {
      try { requiredDns = await provider.getRequiredDns(input) } catch { /* retain last-known current-provider records */ }
      try {
        routing = await provider.verifyRouting(input)
        if (routing.providerMetadata) providerMetadata = routing.providerMetadata
        if (routing.canonicalHost) canonicalHost = routing.canonicalHost
      } catch { /* keep previous diagnostics and retry later */ }
    }
  }

  if (registrationFailure) {
    routing.diagnostics = [...routing.diagnostics, {
      check: 'hosting_registration',
      label: 'Hosting registration',
      state: 'failed',
      ok: false,
      expected: provider.name,
      observed: null,
      message: registrationFailure,
      checkedAt: now,
    } satisfies DomainDiagnostic]
  }

  if (routing.registered) {
    providerRegistrationStatus = 'registered'
    providerRegisteredAt = providerRegisteredAt || now
  }

  const routingOk = (routing.routingReady ?? (routing.apexOk && routing.wwwOk)) && routing.registered && routing.providerVerified
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
    if (tls.providerMetadata) providerMetadata = tls.providerMetadata
    if (tls.canonicalHost) canonicalHost = tls.canonicalHost
    tlsStatus = tls.status
    tlsDiagnostics = tls.diagnostics
    if (tls.status === 'active') {
      const publicRouting = await provider.verifyPublicRouting(input)
      publicRoutingStatus = publicRouting.active ? 'active' : 'pending'
      if (publicRouting.canonicalHost) canonicalHost = publicRouting.canonicalHost
      publicDiagnostics = publicRouting.diagnostics
      if (publicRouting.active) lifecycleStatus = 'ACTIVE'
    }
  }

  const diagnostics = [ownership, ...routing.diagnostics, ...tlsDiagnostics, ...publicDiagnostics]
  const failure = diagnostics.find((item) => item.state === 'failed')
  const active = lifecycleStatus === 'ACTIVE' && tlsStatus === 'active' && publicRoutingStatus === 'active'
  const failureReason = failure?.message || ''
  const failureCount = active ? 0 : failure ? Number(slot.failureCount || 0) + 1 : Number(slot.failureCount || 0)
  const retryMs = active ? ACTIVE_RECHECK_MS : lifecycleStatus === 'TLS_PROVISIONING' ? TLS_RECHECK_MS : DNS_RECHECK_MS

  return {
    requiredDns,
    canonicalHost,
    lifecycleStatus,
    provider: provider.name,
    providerRegistrationStatus,
    providerRegisteredAt,
    providerRequestId,
    providerMetadata,
    publicRoutingStatus,
    status: active ? 'verified' : 'pending',
    tlsStatus,
    diagnostics,
    failureReason,
    failureCount,
    lastCheckedAt: now,
    nextCheckAt: new Date(now.getTime() + retryMs),
    ownershipVerifiedAt: ownership.ok ? (slot.ownershipVerifiedAt || now) : null,
    routingVerifiedAt: routingOk ? (slot.routingVerifiedAt || now) : null,
    tlsActiveAt: tlsStatus === 'active' ? (slot.tlsActiveAt || now) : null,
    activeAt: active ? (slot.activeAt || now) : null,
    verifiedAt: active ? (slot.verifiedAt || now) : null,
    active,
  }
}

const migrationStatus = (record: any): string => String(record?.providerMigration?.migrationStatus || '')
const migrationActiveBeforeSwitch = (record: any) => ['CF_REGISTERED', 'WAITING_DNS', 'CF_TLS_ACTIVE'].includes(migrationStatus(record))

const eligibleForProviderMigration = (record: any) => Boolean(
  record
  && !record.candidate?.domain
  && record.entitlementStatus !== 'suspended'
  && (record.provider || 'vercel') === 'vercel'
  && deriveLifecycle(record) === 'ACTIVE'
  && record.status === 'verified'
  && record.tlsStatus === 'active'
  && record.publicRoutingStatus === 'active'
  && (!record.providerMigration || ['NOT_STARTED'].includes(migrationStatus(record))),
)

const startProviderMigration = async (record: any) => {
  if (!record) throw new ApiError(404, 'Custom domain record not found')
  if (record.providerMigration && !['NOT_STARTED'].includes(migrationStatus(record))) return publicDomainStatus(record)
  if (!eligibleForProviderMigration(record)) {
    throw new ApiError(409, 'Only ACTIVE Vercel custom domains without a pending replacement can start the Cloudflare migration')
  }

  const legacyProvider = String(record.provider || 'vercel')
  const targetProvider = config.domains.provider_migration_target
  if (legacyProvider === targetProvider) throw new ApiError(409, 'This custom domain is already using the target provider')
  const provider = DomainProviderService.byName(targetProvider)
  const input = { domain: record.domain, organizationId: record.organizationId, ownershipToken: record.ownershipToken }
  const registration = await provider.registerDomain(input)
  if (!registration.registered) throw new ApiError(503, `Target domain provider (${targetProvider}) did not register the domain`)
  const requiredDns = await provider.getRequiredDns(input)
  const now = new Date()
  const target = newLifecycleState({
    domain: record.domain,
    ownershipToken: record.ownershipToken,
    provider: targetProvider,
    providerRequestId: registration.providerRequestId,
    providerMetadata: registration.providerMetadata,
    registered: true,
    requiredDns,
  })
  target.providerRegisteredAt = now
  if (Array.isArray(record.retiredDomains)) {
    for (const retired of record.retiredDomains) {
      if (!retired.provider) retired.provider = legacyProvider
    }
  }
  record.providerMigration = {
    legacyProvider,
    targetProvider,
    migrationStatus: 'CF_REGISTERED',
    legacy: snapshotLifecycleState(record),
    target,
    startedAt: now,
    cloudflareRegisteredAt: now,
    waitingDnsAt: null,
    cloudflareTlsActiveAt: null,
    trafficSwitchedAt: null,
    rollbackUntil: null,
    vercelRemovedAt: null,
    lastCheckedAt: now,
    nextCheckAt: now,
    failureReason: '',
    failureCount: 0,
  }
  record.nextCheckAt = now
  await record.save()
  await CacheInvalidationService.invalidateTenant(record.organizationId)
  return publicDomainStatus(record)
}

const updateMigrationTarget = (target: any, patch: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(patch)) target[key] = value
}

const advanceProviderMigration = async (record: any) => {
  const migration = record?.providerMigration
  if (!migration || ['NOT_STARTED', 'VERCEL_REMOVED'].includes(migrationStatus(record))) return publicDomainStatus(record)
  if (migration.migrationStatus === 'TRAFFIC_SWITCHED') return publicDomainStatus(record)
  const target = migration.target
  if (!target?.domain) throw new ApiError(500, 'Provider migration target state is missing')

  const now = new Date()
  const provider = DomainProviderService.byName(migration.targetProvider || target.provider || 'cloudflare')
  const input = { domain: target.domain, organizationId: record.organizationId, ownershipToken: target.ownershipToken }
  try {
    // Registration is idempotent for the Cloudflare provider and also repairs a
    // partially deleted apex/www pair before we ask the customer to touch DNS.
    const registration: DomainRegistrationResult = await provider.registerDomain(input)
    if (registration?.registered) {
      target.providerRegistrationStatus = 'registered'
      target.providerRegisteredAt = target.providerRegisteredAt || now
      if (registration.providerRequestId) target.providerRequestId = registration.providerRequestId
      if (registration.providerMetadata) target.providerMetadata = registration.providerMetadata
    }

    target.requiredDns = await provider.getRequiredDns(input)
    const [ownership, routing, tls] = await Promise.all([
      ownershipDiagnostic(target),
      provider.verifyRouting(input),
      provider.getTlsStatus(input),
    ])
    if (routing.providerMetadata) target.providerMetadata = routing.providerMetadata
    if (tls.providerMetadata) target.providerMetadata = tls.providerMetadata
    const registered = routing.registered || target.providerRegistrationStatus === 'registered'
    const providerValidated = registered && routing.providerVerified
    const tlsActive = tls.status === 'active'
    const routeReady = Boolean(routing.routingReady ?? (routing.apexOk && routing.wwwOk))
    const diagnostics = [ownership, ...routing.diagnostics, ...tls.diagnostics]
    const failure = diagnostics.find((item) => item.state === 'failed')

    updateMigrationTarget(target, {
      provider: provider.name,
      canonicalHost: routing.canonicalHost || target.canonicalHost || target.domain,
      providerRegistrationStatus: registered ? 'registered' : 'pending',
      providerRegisteredAt: registered ? (target.providerRegisteredAt || now) : target.providerRegisteredAt,
      lifecycleStatus: !ownership.ok ? 'PENDING_DNS' : !providerValidated ? 'OWNERSHIP_VERIFIED' : tlsActive ? 'ROUTING_VERIFIED' : 'TLS_PROVISIONING',
      status: 'pending',
      tlsStatus: tls.status,
      publicRoutingStatus: 'pending',
      diagnostics,
      failureReason: failure?.message || '',
      failureCount: failure ? Number(target.failureCount || 0) + 1 : Number(target.failureCount || 0),
      lastCheckedAt: now,
      nextCheckAt: new Date(now.getTime() + MIGRATION_RECHECK_MS),
      ownershipVerifiedAt: ownership.ok ? (target.ownershipVerifiedAt || now) : null,
      tlsActiveAt: tlsActive ? (target.tlsActiveAt || now) : null,
    })

    migration.lastCheckedAt = now
    migration.nextCheckAt = target.nextCheckAt
    migration.failureReason = failure?.message || ''
    migration.failureCount = failure ? Number(migration.failureCount || 0) + 1 : 0

    if (!providerValidated || !tlsActive) {
      migration.migrationStatus = 'WAITING_DNS'
      migration.waitingDnsAt = migration.waitingDnsAt || now
      record.nextCheckAt = target.nextCheckAt
      await record.save()
      await CacheInvalidationService.invalidateTenant(record.organizationId)
      return publicDomainStatus(record)
    }

    migration.migrationStatus = 'CF_TLS_ACTIVE'
    migration.cloudflareTlsActiveAt = migration.cloudflareTlsActiveAt || now

    // Do not use the public marker alone to decide that traffic switched: while
    // DNS still points at Vercel the same Opygen runtime can answer that marker.
    // The DNS route must point at Cloudflare AND the Cloudflare runtime marker
    // must pass before the serving provider is changed in MongoDB.
    if (routeReady) {
      const publicRouting = await provider.verifyPublicRouting(input)
      target.diagnostics = [...diagnostics, ...publicRouting.diagnostics]
      if (publicRouting.active) {
        const canonicalHost = routing.canonicalHost || publicRouting.canonicalHost || target.domain
        updateMigrationTarget(target, {
          canonicalHost,
          lifecycleStatus: 'ACTIVE',
          status: 'verified',
          tlsStatus: 'active',
          publicRoutingStatus: 'active',
          routingVerifiedAt: target.routingVerifiedAt || now,
          activeAt: target.activeAt || now,
          verifiedAt: target.verifiedAt || now,
          failureReason: '',
          failureCount: 0,
          lastCheckedAt: now,
          nextCheckAt: new Date(now.getTime() + ACTIVE_RECHECK_MS),
        })
        // Keep the Vercel registration untouched. Only the serving provider
        // snapshot changes here; Vercel is deleted later by explicit finalize.
        applyLifecycleResult(record, target)
        record.ownershipToken = target.ownershipToken
        migration.migrationStatus = 'TRAFFIC_SWITCHED'
        migration.trafficSwitchedAt = migration.trafficSwitchedAt || now
        migration.rollbackUntil = migration.rollbackUntil || new Date(now.getTime() + config.domains.provider_migration_rollback_grace_ms)
        migration.failureReason = ''
        migration.failureCount = 0
        migration.nextCheckAt = migration.rollbackUntil
        record.nextCheckAt = migration.rollbackUntil
        await record.save()
        await Organization.updateOne(
          { organizationId: record.organizationId },
          { $set: { domain: record.domain, domain_Verify: true, domain_dns: record.requiredDns } },
        )
        await CacheInvalidationService.invalidateTenant(record.organizationId, [record.domain, `www.${record.domain}`])
        return publicDomainStatus(record)
      }
    }

    record.nextCheckAt = target.nextCheckAt
    await record.save()
    await CacheInvalidationService.invalidateTenant(record.organizationId)
    return publicDomainStatus(record)
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'Target provider migration check failed').slice(0, 500)
    migration.failureReason = message
    migration.failureCount = Number(migration.failureCount || 0) + 1
    migration.lastCheckedAt = now
    migration.nextCheckAt = new Date(now.getTime() + MIGRATION_RECHECK_MS)
    record.nextCheckAt = migration.nextCheckAt
    if (target) {
      target.failureReason = message
      target.failureCount = Number(target.failureCount || 0) + 1
      target.lastCheckedAt = now
      target.nextCheckAt = migration.nextCheckAt
    }
    await record.save()
    await CacheInvalidationService.invalidateTenant(record.organizationId)
    return publicDomainStatus(record)
  }
}

const finalizeProviderMigration = async (record: any) => {
  const migration = record?.providerMigration
  if (!migration || migration.migrationStatus !== 'TRAFFIC_SWITCHED') {
    throw new ApiError(409, 'Provider migration is not ready for legacy-provider removal')
  }
  const now = new Date()
  const rollbackUntil = migration.rollbackUntil ? new Date(migration.rollbackUntil) : null
  if (!rollbackUntil || rollbackUntil.getTime() > now.getTime()) {
    throw new ApiError(409, `Rollback grace period is still active until ${rollbackUntil?.toISOString() || 'unknown'}`)
  }
  const legacyProvider = DomainProviderService.byName(migration.legacyProvider || 'vercel')
  await legacyProvider.removeDomain(record.domain)
  migration.migrationStatus = 'VERCEL_REMOVED'
  migration.vercelRemovedAt = now
  migration.lastCheckedAt = now
  migration.nextCheckAt = null
  migration.failureReason = ''
  migration.failureCount = 0
  record.nextCheckAt = new Date(now.getTime() + ACTIVE_RECHECK_MS)
  await record.save()
  await CacheInvalidationService.invalidateTenant(record.organizationId)
  return publicDomainStatus(record)
}

const rollbackProviderMigration = async (record: any) => {
  const migration = record?.providerMigration
  if (!migration || ['NOT_STARTED', 'VERCEL_REMOVED'].includes(migration.migrationStatus)) {
    throw new ApiError(409, migration?.migrationStatus === 'VERCEL_REMOVED'
      ? 'Vercel has already been removed; automatic rollback is no longer available'
      : 'No active provider migration exists')
  }
  const targetProvider = DomainProviderService.byName(migration.targetProvider || 'cloudflare')
  const legacyProvider = DomainProviderService.byName(migration.legacyProvider || 'vercel')
  const legacy = migration.legacy
  if (!legacy?.domain) throw new ApiError(500, 'Legacy provider snapshot is missing')
  const input = { domain: legacy.domain, organizationId: record.organizationId, ownershipToken: legacy.ownershipToken }
  const switched = migration.migrationStatus === 'TRAFFIC_SWITCHED'

  if (switched) {
    // Operators/customers must first point DNS back to the records exposed as
    // rollbackDns. We verify Vercel is actually serving HTTPS before restoring
    // the database provider snapshot, preventing a rollback-induced outage.
    if (!(await legacyProvider.hasDomain(legacy.domain))) throw new ApiError(409, 'Legacy Vercel hostname is no longer registered; rollback is blocked')
    const [routing, tls, publicRouting] = await Promise.all([
      legacyProvider.verifyRouting(input),
      legacyProvider.getTlsStatus(input),
      legacyProvider.verifyPublicRouting(input),
    ])
    const routeReady = Boolean(routing.routingReady ?? (routing.apexOk && routing.wwwOk))
    if (!routeReady || !routing.registered || !routing.providerVerified || tls.status !== 'active' || !publicRouting.active) {
      throw new ApiError(409, 'Rollback DNS is not serving from Vercel yet. Restore the shown rollback DNS records, wait for propagation, then retry rollback.')
    }
    applyLifecycleResult(record, legacy)
    record.ownershipToken = legacy.ownershipToken
    record.canonicalHost = routing.canonicalHost || publicRouting.canonicalHost || legacy.canonicalHost || legacy.domain
    record.lifecycleStatus = 'ACTIVE'
    record.status = 'verified'
    record.tlsStatus = 'active'
    record.publicRoutingStatus = 'active'
    record.nextCheckAt = new Date(Date.now() + ACTIVE_RECHECK_MS)
    migration.migrationStatus = 'NOT_STARTED'
    migration.failureReason = ''
    migration.failureCount = 0
    migration.lastCheckedAt = new Date()
    migration.nextCheckAt = null
    await record.save()
    await Organization.updateOne(
      { organizationId: record.organizationId },
      { $set: { domain: record.domain, domain_Verify: true, domain_dns: record.requiredDns } },
    )
    await CacheInvalidationService.invalidateTenant(record.organizationId, [record.domain, `www.${record.domain}`])
  }

  try {
    await targetProvider.removeDomain(record.domain)
    record.providerMigration = null
  } catch (error) {
    migration.migrationStatus = 'NOT_STARTED'
    migration.failureReason = `Serving provider rolled back successfully, but Cloudflare cleanup must be retried: ${error instanceof Error ? error.message : 'cleanup failed'}`.slice(0, 500)
    migration.nextCheckAt = null
  }
  await record.save()
  await CacheInvalidationService.invalidateTenant(record.organizationId)
  return publicDomainStatus(record)
}

const startProviderMigrationByOrganization = async (organizationId: string) => {
  const record: any = await DomainRecord.findOne({ organizationId })
  return startProviderMigration(record)
}

const advanceProviderMigrationByOrganization = async (organizationId: string) => {
  const record: any = await DomainRecord.findOne({ organizationId })
  if (!record) throw new ApiError(404, 'Custom domain record not found')
  return advanceProviderMigration(record)
}

const finalizeProviderMigrationByOrganization = async (organizationId: string) => {
  const record: any = await DomainRecord.findOne({ organizationId })
  if (!record) throw new ApiError(404, 'Custom domain record not found')
  return finalizeProviderMigration(record)
}

const rollbackProviderMigrationByOrganization = async (organizationId: string) => {
  const record: any = await DomainRecord.findOne({ organizationId })
  if (!record) throw new ApiError(404, 'Custom domain record not found')
  return rollbackProviderMigration(record)
}

const queueProviderCleanup = (record: any, domain: string, retireAfter: Date, redirectStartedAt = new Date(), providerName?: string) => {
  if (!domain || domain === record.domain) return
  const existing = (Array.isArray(record.retiredDomains) ? record.retiredDomains : [])
    .map((item: any) => typeof item.toObject === 'function' ? item.toObject() : item)
    .filter((item: any) => item.domain !== domain)
  record.retiredDomains = [
    ...existing,
    { domain, provider: providerName || record.provider || config.domains.provider, redirectStartedAt, retireAfter, providerRemovedAt: null, lastRemovalAttemptAt: null, removalError: '' },
  ]
  const currentNext = record.nextCheckAt ? new Date(record.nextCheckAt) : null
  if (!currentNext || retireAfter.getTime() < currentNext.getTime()) record.nextCheckAt = retireAfter
}

const cleanupRetiredDomains = async (record: any) => {
  const retired = Array.isArray(record.retiredDomains) ? record.retiredDomains : []
  if (!retired.length) return
  const now = new Date()
  const keep: any[] = []
  for (const item of retired) {
    const raw = typeof item.toObject === 'function' ? item.toObject() : item
    const retireAfter = new Date(raw.retireAfter)
    if (retireAfter.getTime() > now.getTime()) {
      keep.push(raw)
      continue
    }
    try {
      const provider = DomainProviderService.byName(raw.provider || record.provider || config.domains.provider)
      await provider.removeDomain(raw.domain)
    } catch (error) {
      keep.push({
        ...raw,
        lastRemovalAttemptAt: now,
        removalError: (error instanceof Error ? error.message : 'Provider removal failed').slice(0, 500),
      })
    }
  }
  record.retiredDomains = keep
}

const promoteCandidate = async (record: any, result: any) => {
  const candidate = typeof record.candidate?.toObject === 'function' ? record.candidate.toObject() : record.candidate
  if (!candidate?.domain || !result.active) return false
  const now = new Date()
  const previousDomain = record.domain
  const previousProvider = record.provider || config.domains.provider
  const retireAfter = new Date(now.getTime() + config.domains.replacement_grace_ms)
  record.domain = candidate.domain
  record.ownershipToken = candidate.ownershipToken
  record.providerRequestId = candidate.providerRequestId || ''
  record.providerMetadata = candidate.providerMetadata || { hostnames: [] }
  applyLifecycleResult(record, result)
  record.candidate = null
  queueProviderCleanup(record, previousDomain, retireAfter, now, previousProvider)
  await record.save()

  await Organization.updateOne(
    { organizationId: record.organizationId },
    { $set: { domain: record.domain, domain_Verify: true, domain_dns: record.requiredDns } },
  )
  await CacheInvalidationService.invalidateTenant(record.organizationId, [previousDomain, record.domain])
  return true
}

const add = async (organizationId: string, input: string) => {
  await TenantPurgeBarrier.assertTenantWritable(organizationId)
  await EntitlementService.assertFeature(organizationId, 'customDomain')
  const domain = normalizeDomain(input)
  const conflicting: any = await DomainRecord.findOne({
    $or: [{ domain }, { 'candidate.domain': domain }, { 'retiredDomains.domain': domain }],
  })
  if (conflicting && conflicting.organizationId !== organizationId) throw new ApiError(409, 'This domain is already attached to another agency')

  const current: any = await DomainRecord.findOne({ organizationId })
  if (current?.domain === domain || current?.candidate?.domain === domain) return publicDomainStatus(current)
  if (current?.providerMigration && !['NOT_STARTED', 'VERCEL_REMOVED'].includes(migrationStatus(current))) {
    throw new ApiError(409, 'Finish or roll back the hosting-provider migration before replacing the custom domain')
  }
  if (conflicting?.organizationId === organizationId && (conflicting.retiredDomains || []).some((item: any) => item.domain === domain)) {
    throw new ApiError(409, 'This hostname is still in its redirect grace period or awaiting provider cleanup and cannot be re-added yet')
  }

  const ownershipToken = randomBytes(24).toString('base64url')
  const provider = DomainProviderService.current()

  let providerRegistration: DomainRegistrationResult
  let dnsRecords: unknown[]
  try {
    providerRegistration = await provider.registerDomain({ domain, organizationId, ownershipToken })
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(503, `Domain provider (${provider.name}) could not register the domain: ${error instanceof Error ? error.message : 'provider unavailable'}`)
  }
  try {
    dnsRecords = await provider.getRequiredDns({ domain, organizationId, ownershipToken })
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(503, `Domain provider (${provider.name}) could not generate DNS records: ${error instanceof Error ? error.message : 'provider unavailable'}`)
  }
  const state = newLifecycleState({
    domain,
    ownershipToken,
    provider: provider.name,
    providerRequestId: providerRegistration.providerRequestId,
    providerMetadata: providerRegistration.providerMetadata,
    registered: providerRegistration.registered,
    requiredDns: dnsRecords,
  })

  const hasServingDomain = Boolean(
    current
    && deriveLifecycle(current) === 'ACTIVE'
    && current.status === 'verified'
    && current.tlsStatus === 'active'
    && current.publicRoutingStatus === 'active',
  )

  if (current && hasServingDomain) {
    const previousCandidate = current.candidate?.domain && current.candidate.domain !== domain ? current.candidate.domain : null
    const previousCandidateProvider = previousCandidate ? (current.candidate?.provider || current.provider || config.domains.provider) : null
    current.candidate = state
    current.entitlementStatus = 'active'
    current.entitlementSuspendedAt = null
    current.entitlementSuspendedReason = ''
    current.nextCheckAt = new Date()
    if (previousCandidate) queueProviderCleanup(current, previousCandidate, new Date(), new Date(), previousCandidateProvider || undefined)
    try {
      await current.save()
    } catch (error: any) {
      if (error?.code === 11000) throw new ApiError(409, 'This domain is already attached to another agency')
      throw error
    }
    await CacheInvalidationService.invalidateTenant(organizationId)
    return publicDomainStatus(current)
  }

  const previousPendingDomain = current?.domain && current.domain !== domain ? current.domain : null
  let record: any
  try {
    record = await DomainRecord.findOneAndUpdate(
      { organizationId },
      {
        $set: {
          ...state,
          entitlementStatus: 'active',
          entitlementSuspendedAt: null,
          entitlementSuspendedReason: '',
          candidate: null,
        },
        $setOnInsert: { retiredDomains: [] },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )
  } catch (error: any) {
    if (error?.code === 11000) throw new ApiError(409, 'This domain is already attached to another agency')
    throw error
  }
  if (!record) throw new ApiError(500, 'Failed to persist custom domain configuration')

  if (previousPendingDomain) {
    queueProviderCleanup(record, previousPendingDomain, new Date(), new Date(), current?.provider || config.domains.provider)
    await record.save()
  }
  await Organization.updateOne({ organizationId }, { $set: { domain, domain_Verify: false, domain_dns: dnsRecords } })
  await CacheInvalidationService.invalidateTenant(organizationId, previousPendingDomain ? [previousPendingDomain] : [])
  return publicDomainStatus(record)
}

const verifyRecord = async (record: any) => {
  await cleanupRetiredDomains(record)

  // A live Vercel hostname must remain ACTIVE while Cloudflare is being
  // pre-validated. In particular, once the customer changes the CNAME, Vercel
  // DNS checks would naturally fail before the Cloudflare check completes; we
  // therefore advance the staged target first and do not downgrade the serving
  // legacy record during that hand-off window.
  if (migrationActiveBeforeSwitch(record)) {
    return advanceProviderMigration(record)
  }

  if (record.candidate?.domain) {
    const result = await evaluateLifecycle(record.candidate, record.organizationId, record.candidate.provider || config.domains.provider)
    applyLifecycleResult(record.candidate, result)
    record.nextCheckAt = result.nextCheckAt
    if (result.active) {
      await promoteCandidate(record, result)
      return publicDomainStatus(record)
    }
    await record.save()
    await CacheInvalidationService.invalidateTenant(record.organizationId)
    return publicDomainStatus(record)
  }

  const result = await evaluateLifecycle(record, record.organizationId, record.provider || config.domains.provider)
  applyLifecycleResult(record, result)
  await record.save()

  await Organization.updateOne(
    { organizationId: record.organizationId },
    { $set: { domain: record.domain, domain_Verify: result.active, domain_dns: record.requiredDns } },
  )
  await CacheInvalidationService.invalidateTenant(record.organizationId)
  return publicDomainStatus(record)
}

const markLifecycleFailure = async (record: any, error: unknown) => {
  const now = new Date()
  const message = error instanceof Error ? error.message : 'Unknown domain lifecycle failure'
  const target = record.candidate?.domain ? record.candidate : record
  const failureCount = Number(target.failureCount || 0) + 1
  target.lifecycleStatus = deriveLifecycle(target)
  if (target.lifecycleStatus === 'ACTIVE') target.lifecycleStatus = 'TLS_PROVISIONING'
  target.status = 'pending'
  if (target.tlsStatus === 'active') target.tlsStatus = 'provisioning'
  target.publicRoutingStatus = 'pending'
  target.failureCount = failureCount
  target.failureReason = message.slice(0, 500)
  target.lastCheckedAt = now
  target.diagnostics = [...(target.diagnostics || []), {
    check: 'lifecycle',
    label: 'Lifecycle',
    state: 'failed',
    ok: false,
    message: message.slice(0, 500),
    checkedAt: now,
  }].slice(-20)
  const retryMinutes = Math.min(360, Math.max(5, 2 ** Math.min(failureCount, 8)))
  target.nextCheckAt = new Date(Date.now() + retryMinutes * 60_000)
  record.nextCheckAt = target.nextCheckAt
  await record.save()
  if (!record.candidate?.domain) {
    await Organization.updateOne({ organizationId: record.organizationId }, { $set: { domain_Verify: false } })
  }
  await CacheInvalidationService.invalidateTenant(record.organizationId)
}

const verifyById = async (organizationId: string, recordId: string) => {
  const record: any = await DomainRecord.findOne({ _id: recordId, organizationId })
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
  const now = new Date()
  const record: any = await DomainRecord.findOne({
    entitlementStatus: { $ne: 'suspended' },
    tlsStatus: 'active',
    $and: [
      {
        $or: [
          { lifecycleStatus: 'ACTIVE', publicRoutingStatus: 'active' },
          { lifecycleStatus: { $exists: false }, status: 'verified' },
        ],
      },
      {
        $or: [
          { domain },
          { retiredDomains: { $elemMatch: { domain, retireAfter: { $gt: now } } } },
        ],
      },
    ],
  }).lean()
  if (!record?.organizationId) return null
  const org: any = await Organization.findOne({ organizationId: record.organizationId }).select('organizationId agencyName sub_domain').lean()
  if (!org) return null
  const access = await TenantAccessService.evaluate(org.organizationId)
  if (!access.publicWebsiteAllowed) TenantAccessMonitoringService.recordPublicDenied(access)
  const canonicalHost = record.canonicalHost || record.domain
  return {
    organizationId: org.organizationId,
    agencyName: org.agencyName,
    canonicalSubdomain: org.sub_domain || org.organizationId,
    canonicalHost,
    redirectTo: rawHost === canonicalHost ? null : `https://${canonicalHost}`,
    lifecycleStatus: deriveLifecycle(record),
    websiteStatus: access.websiteStatus,
    publicAccess: TenantAccessService.toPublicAccess(access),
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
  startProviderMigrationByOrganization,
  advanceProviderMigrationByOrganization,
  finalizeProviderMigrationByOrganization,
  rollbackProviderMigrationByOrganization,
  eligibleForProviderMigration,
}
