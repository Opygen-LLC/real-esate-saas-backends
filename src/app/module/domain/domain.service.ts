import dns from 'dns/promises'
import { randomBytes } from 'crypto'
import { domainToASCII } from 'url'
import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import config from '../../../config'
import { Organization } from '../organization/organization.model'
import { DomainRecord } from './domain.model'
import { EntitlementService } from '../entitlement/entitlement.service'
import { Resilience } from '../../../shared/resilience'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { normalizeSubdomain, RESERVED_SUBDOMAINS } from '../../helpers/identity'
import { buildTenantWebsiteUrl } from '../../helpers/publicWebsiteUrl'
import { SubdomainAlias } from './subdomainAlias.model'

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

const requiredDns = (domain: string, token: string) => [
  { type: 'TXT', name: `${config.domains.ownership_prefix}.${domain}`, host: config.domains.ownership_prefix, value: `realestate-saas=${token}`, purpose: 'ownership' },
  { type: 'A', name: domain, host: '@', value: config.domains.a_target, purpose: 'routing' },
  { type: 'CNAME', name: `www.${domain}`, host: 'www', value: config.domains.cname_target, purpose: 'routing' },
]

const add = async (organizationId: string, input: string) => {
  await EntitlementService.assertFeature(organizationId, 'customDomain')
  const domain = normalizeDomain(input)
  const existing = await DomainRecord.findOne({ domain })
  if (existing && existing.organizationId !== organizationId) throw new ApiError(409, 'This domain is already attached to another agency')

  const ownershipToken = existing?.ownershipToken || randomBytes(24).toString('base64url')
  let record
  try {
    record = await DomainRecord.findOneAndUpdate(
      { organizationId },
      { $set: { domain, ownershipToken, status: 'pending', tlsStatus: 'not_started', requiredDns: requiredDns(domain, ownershipToken), diagnostics: [], nextCheckAt: new Date(), failureCount: 0 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    )
  } catch (error: any) {
    if (error?.code === 11000) throw new ApiError(409, 'This domain is already attached to another agency')
    throw error
  }
  if (!record) throw new ApiError(500, 'Failed to persist custom domain configuration')
  await Organization.updateOne({ organizationId }, { $set: { domain, domain_Verify: false, domain_dns: record.requiredDns } })
  await CacheInvalidationService.invalidateTenant(organizationId)
  return record
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
  const org = await Organization.findOne({ organizationId }).select('sub_domain websiteStatus').lean()
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
  const direct = await Organization.findOne({ sub_domain: subdomain }).select('organizationId sub_domain websiteStatus').lean()
  if (direct) return {
    organizationId: direct.organizationId,
    canonicalSubdomain: direct.sub_domain,
    isAlias: false,
    websiteStatus: direct.websiteStatus || 'published',
    websiteUrl: buildTenantWebsiteUrl(direct.sub_domain || direct.organizationId),

  }
  const alias = await SubdomainAlias.findOne({ alias: subdomain }).lean()
  if (!alias) return null
  const canonical = await Organization.findOne({ organizationId: alias.organizationId }).select('sub_domain websiteStatus').lean()
  if (!canonical) return null
  return {
    organizationId: alias.organizationId,
    canonicalSubdomain: canonical.sub_domain || alias.canonicalSubdomain,
    isAlias: true,
    websiteStatus: canonical.websiteStatus || 'published',
    websiteUrl: buildTenantWebsiteUrl(canonical.sub_domain || alias.canonicalSubdomain),
  }
}

const resolveTxt = async (name: string) => {
  try { return (await dns.resolveTxt(name)).flat() } catch { return [] }
}
const resolveA = async (name: string) => {
  try { return await dns.resolve4(name) } catch { return [] }
}
const resolveCname = async (name: string) => {
  try { return (await dns.resolveCname(name)).map((v: string) => v.replace(/\.$/, '').toLowerCase()) } catch { return [] }
}

const requestTls = async (record: any) => {
  if (!config.domains.tls_provider_url) {
    if (config.isProduction) throw new ApiError(503, 'TLS provider is not configured')
    return { tlsStatus: 'provisioning' as const, providerRequestId: 'development-manual' }
  }
  const response = await Resilience.fetch('domain-tls-provider', config.domains.tls_provider_url, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(config.domains.tls_provider_token ? { authorization: `Bearer ${config.domains.tls_provider_token}` } : {}) },
    body: JSON.stringify({ domain: record.domain, domains: [record.domain, `www.${record.domain}`], organizationId: record.organizationId, requestId: record.providerRequestId || undefined }),
  }, { timeoutMs: 10000 })
  if (!response.ok) throw new ApiError(502, `TLS provider rejected domain provisioning (${response.status})`)
  const payload = await response.json().catch(() => ({})) as any
  return { tlsStatus: payload.status === 'active' ? 'active' as const : 'provisioning' as const, providerRequestId: String(payload.id || payload.requestId || '') }
}

const verifyRecord = async (record: any) => {
  const txtName = `${config.domains.ownership_prefix}.${record.domain}`
  const [txt, addresses, cnames] = await Promise.all([resolveTxt(txtName), resolveA(record.domain), resolveCname(`www.${record.domain}`)])
  const expectedTxt = `realestate-saas=${record.ownershipToken}`
  const ownershipOk = txt.includes(expectedTxt)
  const apexOk = addresses.includes(config.domains.a_target)
  const wwwOk = cnames.includes(config.domains.cname_target.toLowerCase())
  const diagnostics = [
    { check: 'ownership_txt', ok: ownershipOk, expected: expectedTxt, observed: txt },
    { check: 'apex_a', ok: apexOk, expected: config.domains.a_target, observed: addresses },
    { check: 'www_cname', ok: wwwOk, expected: config.domains.cname_target, observed: cnames },
  ]
  const verified = ownershipOk && apexOk && wwwOk
  const failureCount = verified ? 0 : Number(record.failureCount || 0) + 1
  const nextMinutes = Math.min(360, Math.max(5, 2 ** Math.min(failureCount, 8)))
  let tlsStatus = record.tlsStatus
  let providerRequestId = record.providerRequestId
  if (verified && tlsStatus !== 'active') {
    // The provider endpoint is expected to be idempotent by domain/requestId.
    // Rechecking lets a provisioning certificate progress to active instead of
    // remaining in an indefinite local 'provisioning' state.
    const tls = await requestTls({ ...record.toObject(), providerRequestId })
    tlsStatus = tls.tlsStatus
    providerRequestId = tls.providerRequestId || providerRequestId
  }
  record.status = verified ? 'verified' : failureCount >= 12 ? 'failed' : 'pending'
  record.tlsStatus = tlsStatus
  record.providerRequestId = providerRequestId
  record.diagnostics = diagnostics
  record.failureCount = failureCount
  record.lastCheckedAt = new Date()
  record.verifiedAt = verified ? (record.verifiedAt || new Date()) : null
  record.nextCheckAt = new Date(Date.now() + nextMinutes * 60_000)
  await record.save()
  await Organization.updateOne({ organizationId: record.organizationId }, { $set: { domain: record.domain, domain_Verify: verified, domain_dns: record.requiredDns } })
  await CacheInvalidationService.invalidateTenant(record.organizationId)
  return record
}


const verifyById = async (recordId: string) => {
  const record: any = await DomainRecord.findById(recordId)
  if (!record) return null
  try { return await verifyRecord(record) }
  catch (error) {
    const failureCount = Number(record.failureCount || 0) + 1
    record.failureCount = failureCount
    if (record.status === 'verified') record.tlsStatus = 'failed'
    if (failureCount >= 12) record.status = 'failed'
    record.diagnostics = [...(record.diagnostics || []), { check: 'lifecycle', ok: false, message: error instanceof Error ? error.message : 'Unknown domain verification failure', at: new Date() }].slice(-20)
    record.nextCheckAt = new Date(Date.now() + Math.min(360, Math.max(5, 2 ** Math.min(failureCount, 8))) * 60_000)
    await record.save()
    await CacheInvalidationService.invalidateTenant(record.organizationId)
    throw error
  }
}

const verify = async (organizationId: string) => {
  const record = await DomainRecord.findOne({ organizationId })
  if (!record) throw new ApiError(404, 'No custom domain is configured')
  return verifyRecord(record)
}

const get = async (organizationId: string) => DomainRecord.findOne({ organizationId })

const retryDue = async (limit = 50) => {
  const records = await DomainRecord.find({ status: { $in: ['pending', 'verified'] }, nextCheckAt: { $lte: new Date() } }).sort({ nextCheckAt: 1 }).limit(limit)
  const results = []
  for (const record of records) {
    try { results.push(await verifyRecord(record)) } catch (error) {
      const failureCount = Number(record.failureCount || 0) + 1
      record.failureCount = failureCount
      if (record.status === 'verified') record.tlsStatus = 'failed'
      if (failureCount >= 12) record.status = 'failed'
      record.diagnostics = [...(record.diagnostics || []), { check: 'lifecycle', ok: false, message: error instanceof Error ? error.message : 'Unknown domain verification failure', at: new Date() }].slice(-20)
      const retryMinutes = Math.min(360, Math.max(5, 2 ** Math.min(failureCount, 8)))
      record.nextCheckAt = new Date(Date.now() + retryMinutes * 60_000); await record.save()
    }
  }
  return { checked: records.length }
}

const resolveVerifiedDomain = async (host: string): Promise<string | null> => {
  const domain = normalizeDomain(host.split(':')[0])
  const record = await DomainRecord.findOne({ domain, status: 'verified', tlsStatus: 'active' }).lean()
  return record?.organizationId || null
}

export const DomainService = { add, get, verify, verifyById, retryDue, resolveVerifiedDomain, normalizeDomain, isSubdomainAvailable, changeSubdomain, resolveSubdomain }
