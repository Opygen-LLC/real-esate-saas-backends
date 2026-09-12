import dns from 'dns/promises'
import ApiError from '../../../../errors/ApiError'
import config from '../../../../config'
import { Resilience } from '../../../../shared/resilience'
import type {
  DomainDiagnostic,
  DomainProvider,
  DomainProviderHealth,
  DomainProviderInput,
  DomainProviderMetadata,
  DomainProviderHostnameMetadata,
  DomainPublicRoutingResult,
  DomainRoutingResult,
  DomainTlsResult,
  RequiredDnsRecord,
} from './domainProvider'

const CHECK_PATH = '/.well-known/opygen-domain-check'
const CHECK_HEADER = 'x-opygen-domain-check'
const CHECK_VALUE = 'real-estate-saas'
const HOSTNAME_ACTIVE_STATUSES = new Set(['active', 'active_redeploying'])
const SSL_FAILURE_STATUSES = new Set([
  'deleted',
  'expired',
  'initializing_timed_out',
  'validation_timed_out',
  'issuance_timed_out',
  'deployment_timed_out',
  'deletion_timed_out',
  'inactive',
])

type CloudflareApiError = { code?: number; message?: string }
type CloudflareEnvelope<T> = {
  success?: boolean
  errors?: CloudflareApiError[]
  messages?: Array<CloudflareApiError | string>
  result?: T
}

type CloudflareValidationRecord = {
  status?: string
  txt_name?: string
  txt_value?: string
  cname?: string
  cname_target?: string
  http_url?: string
  http_body?: string
}

type CloudflareCustomHostname = {
  id?: string
  hostname?: string
  status?: string
  verification_errors?: string[]
  ownership_verification?: {
    name?: string
    type?: string
    value?: string
  }
  ssl?: {
    id?: string
    method?: string
    type?: string
    status?: string
    validation_records?: CloudflareValidationRecord[]
    validation_errors?: Array<{ message?: string } | string>
  }
}

type CloudflareZone = {
  id?: string
  name?: string
  status?: string
  account?: { id?: string; name?: string }
}

type CloudflareFallbackOrigin = {
  origin?: string
  status?: string
  errors?: string[]
}

type RegistrationOne = {
  hostname: CloudflareCustomHostname
  created: boolean
}

type DnsObservation = {
  cnames: string[]
  ipv4: string[]
  ipv6: string[]
}

const diagnostic = (
  check: DomainDiagnostic['check'],
  label: string,
  ok: boolean,
  options: Partial<Pick<DomainDiagnostic, 'expected' | 'observed' | 'message' | 'state'>> = {},
): DomainDiagnostic => ({
  check,
  label,
  ok,
  state: options.state || (ok ? 'pass' : options.message ? 'failed' : 'pending'),
  checkedAt: new Date(),
  ...options,
})

const normalizeTarget = (value: string) => value.trim().replace(/\.$/, '').toLowerCase()
const hostnamePair = (domain: string): [string, string] => [normalizeTarget(domain), `www.${normalizeTarget(domain)}`]
const apexRequired = () => config.domains.cloudflare_apex_routing_mode === 'required'
const isApexHostname = (hostname: string | undefined, domain: string) => normalizeTarget(String(hostname || '')) === normalizeTarget(domain)
const canonicalFor = (domain: string, apexUsable: boolean) => apexUsable ? normalizeTarget(domain) : `www.${normalizeTarget(domain)}`

const providerConfigured = () => Boolean(
  config.domains.cloudflare_account_id
  && config.domains.cloudflare_zone_id
  && config.domains.cloudflare_api_token
  && config.domains.cloudflare_saas_fallback_origin
  && config.domains.cloudflare_saas_cname_target,
)

const requireConfigured = () => {
  if (!providerConfigured()) throw new ApiError(503, 'Cloudflare custom-domain provider is not fully configured')
}

const apiUrl = (path: string) => `${config.domains.cloudflare_api_base.replace(/\/$/, '')}${path}`
const zoneApiUrl = (path = '') => apiUrl(`/zones/${encodeURIComponent(config.domains.cloudflare_zone_id)}${path}`)
const customHostnamesUrl = (suffix = '') => zoneApiUrl(`/custom_hostnames${suffix}`)

const cloudflareFetch = async (
  service: string,
  url: string,
  init: RequestInit = {},
  expectedStatuses: number[] = [200],
): Promise<Response> => {
  requireConfigured()
  const headers = new Headers(init.headers || {})
  headers.set('authorization', `Bearer ${config.domains.cloudflare_api_token}`)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  headers.set('accept', 'application/json')
  return Resilience.fetch(service, url, { ...init, headers }, {
    timeoutMs: config.domains.provider_timeout_ms,
    expectedStatuses,
  })
}

const parseEnvelope = async <T>(response: Response): Promise<CloudflareEnvelope<T>> => {
  return response.json().catch(() => ({})) as Promise<CloudflareEnvelope<T>>
}

const errorDetail = (payload: CloudflareEnvelope<unknown>, fallback: string): string => {
  const error = Array.isArray(payload.errors) ? payload.errors.find((item) => item?.message) : undefined
  if (error?.message) return error.message
  const message = Array.isArray(payload.messages)
    ? payload.messages.find((item) => typeof item === 'string' ? Boolean(item) : Boolean(item?.message))
    : undefined
  if (typeof message === 'string') return message
  if (message && typeof message === 'object' && message.message) return message.message
  return fallback
}

const metadataFor = (hostnames: Array<CloudflareCustomHostname | null | undefined>): DomainProviderMetadata => ({
  hostnames: hostnames
    .filter((item): item is CloudflareCustomHostname => Boolean(item?.hostname && item?.id))
    .map((item): DomainProviderHostnameMetadata => ({
      hostname: normalizeTarget(String(item.hostname)),
      providerId: String(item.id),
      ...(item.status ? { status: item.status } : {}),
      ...(item.ssl?.status ? { sslStatus: item.ssl.status } : {}),
    })),
})

const findCustomHostname = async (hostname: string): Promise<CloudflareCustomHostname | null> => {
  const url = new URL(customHostnamesUrl())
  url.searchParams.set('hostname', normalizeTarget(hostname))
  url.searchParams.set('page', '1')
  url.searchParams.set('per_page', '5')
  const response = await cloudflareFetch('cloudflare-custom-hostname-list', url.toString(), { method: 'GET' }, [200])
  const payload = await parseEnvelope<CloudflareCustomHostname[]>(response)
  if (!response.ok || payload.success === false) {
    throw new ApiError(502, `Cloudflare custom-hostname lookup failed: ${errorDetail(payload, `status ${response.status}`)}`)
  }
  const exact = Array.isArray(payload.result)
    ? payload.result.find((item) => normalizeTarget(String(item?.hostname || '')) === normalizeTarget(hostname))
    : undefined
  return exact || null
}

const getCustomHostnameById = async (id: string): Promise<CloudflareCustomHostname | null> => {
  const response = await cloudflareFetch(
    'cloudflare-custom-hostname-detail',
    customHostnamesUrl(`/${encodeURIComponent(id)}`),
    { method: 'GET' },
    [200, 404],
  )
  if (response.status === 404) return null
  const payload = await parseEnvelope<CloudflareCustomHostname>(response)
  if (!response.ok || payload.success === false || !payload.result) {
    throw new ApiError(502, `Cloudflare custom-hostname detail lookup failed: ${errorDetail(payload, `status ${response.status}`)}`)
  }
  return payload.result
}

const getCurrentCustomHostname = async (hostname: string): Promise<CloudflareCustomHostname | null> => {
  const listed = await findCustomHostname(hostname)
  if (!listed?.id) return listed
  return getCustomHostnameById(listed.id)
}

const createOne = async (hostname: string, input: DomainProviderInput, role: 'apex' | 'www'): Promise<RegistrationOne> => {
  const existing = await getCurrentCustomHostname(hostname)
  if (existing) return { hostname: existing, created: false }

  const response = await cloudflareFetch(
    'cloudflare-custom-hostname-create',
    customHostnamesUrl(),
    {
      method: 'POST',
      body: JSON.stringify({
        hostname,
        custom_metadata: {
          organization_id: input.organizationId,
          opygen_domain: input.domain,
          opygen_role: role,
        },
        ssl: {
          method: 'txt',
          type: 'dv',
          settings: { min_tls_version: '1.2' },
        },
      }),
    },
    [200, 201, 400, 409],
  )

  const payload = await parseEnvelope<CloudflareCustomHostname>(response)
  if (response.ok && payload.success !== false && payload.result) return { hostname: payload.result, created: true }

  // Registration is idempotent. A concurrent request can create the hostname
  // between our lookup and POST, so re-read before surfacing a provider error.
  const raced = await getCurrentCustomHostname(hostname).catch(() => null)
  if (raced) return { hostname: raced, created: false }

  const detail = errorDetail(payload, `status ${response.status}`)
  const conflict = response.status === 409 || /already|exist|conflict|ownership|another/i.test(detail)
  throw new ApiError(conflict ? 409 : 502, `Cloudflare could not register ${hostname}: ${detail}`)
}

const deleteOneById = async (id: string) => {
  const response = await cloudflareFetch(
    'cloudflare-custom-hostname-delete',
    customHostnamesUrl(`/${encodeURIComponent(id)}`),
    { method: 'DELETE' },
    [200, 404],
  )
  if (response.status === 404) return
  const payload = await parseEnvelope<unknown>(response)
  if (!response.ok || payload.success === false) {
    throw new ApiError(502, `Cloudflare custom-hostname removal failed: ${errorDetail(payload, `status ${response.status}`)}`)
  }
}

const removeOne = async (hostname: string) => {
  const existing = await findCustomHostname(hostname)
  if (!existing?.id) return
  await deleteOneById(existing.id)
}

const getPair = async (input: DomainProviderInput): Promise<[CloudflareCustomHostname | null, CloudflareCustomHostname | null]> => {
  const [apex, www] = hostnamePair(input.domain)
  return Promise.all([getCurrentCustomHostname(apex), getCurrentCustomHostname(www)])
}

const hostForRecordName = (recordName: string, baseDomain: string): string => {
  const name = normalizeTarget(recordName)
  const base = normalizeTarget(baseDomain)
  if (name === base) return '@'
  if (name.endsWith(`.${base}`)) return name.slice(0, -(base.length + 1))
  return name
}

const validationRecords = (input: DomainProviderInput, hostnames: Array<CloudflareCustomHostname | null>): RequiredDnsRecord[] => {
  const records: RequiredDnsRecord[] = []
  for (const hostname of hostnames) {
    const required = apexRequired() || !isApexHostname(hostname?.hostname, input.domain)
    const optionalNote = required ? undefined : 'Optional apex validation. Configure this only if your DNS provider supports apex CNAME flattening, ALIAS, or ANAME.'
    const ownership = hostname?.ownership_verification
    if (ownership?.name && ownership?.value && String(ownership.type || 'txt').toLowerCase() === 'txt') {
      records.push({
        type: 'TXT',
        name: normalizeTarget(ownership.name),
        host: hostForRecordName(ownership.name, input.domain),
        value: String(ownership.value).trim(),
        purpose: 'provider_verification',
        source: 'cloudflare_hostname_validation',
        required,
        ...(optionalNote ? { note: optionalNote } : {}),
      })
    }

    for (const validation of Array.isArray(hostname?.ssl?.validation_records) ? hostname!.ssl!.validation_records! : []) {
      if (validation?.txt_name && validation?.txt_value) {
        records.push({
          type: 'TXT',
          name: normalizeTarget(validation.txt_name),
          host: hostForRecordName(validation.txt_name, input.domain),
          value: String(validation.txt_value).trim(),
          purpose: 'provider_verification',
          source: 'cloudflare_ssl_validation',
          required,
          ...(optionalNote ? { note: optionalNote } : {}),
        })
      } else if (validation?.cname && validation?.cname_target) {
        records.push({
          type: 'CNAME',
          name: normalizeTarget(validation.cname),
          host: hostForRecordName(validation.cname, input.domain),
          value: normalizeTarget(validation.cname_target),
          purpose: 'provider_verification',
          source: 'cloudflare_ssl_validation',
          required,
          ...(optionalNote ? { note: optionalNote } : {}),
        })
      }
    }
  }

  const seen = new Set<string>()
  return records.filter((record) => {
    const key = `${record.type}|${record.name}|${record.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const resolveDns = async (hostname: string): Promise<DnsObservation> => {
  const [cnames, ipv4, ipv6] = await Promise.all([
    dns.resolveCname(hostname).then((items) => items.map(normalizeTarget)).catch(() => [] as string[]),
    dns.resolve4(hostname).catch(() => [] as string[]),
    dns.resolve6(hostname).catch(() => [] as string[]),
  ])
  return { cnames, ipv4, ipv6 }
}

const matchesSaasTarget = (observed: DnsObservation, target: DnsObservation, cnameTarget: string): boolean => {
  const expected = normalizeTarget(cnameTarget)
  if (observed.cnames.includes(expected)) return true
  const observedAddresses = [...observed.ipv4, ...observed.ipv6]
  const targetAddresses = new Set([...target.ipv4, ...target.ipv6])
  // Apex CNAME flattening and proxied DNS hide the CNAME from recursive
  // resolvers. Accept the flattened result only when every observed address is
  // currently also returned for the SaaS target, not merely on one overlap.
  return observedAddresses.length > 0
    && targetAddresses.size > 0
    && observedAddresses.every((address) => targetAddresses.has(address))
}

const verifyPublicHost = async (host: string) => {
  try {
    const response = await Resilience.fetch('cloudflare-domain-public-route', `https://${host}${CHECK_PATH}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'manual',
    }, { timeoutMs: config.domains.provider_timeout_ms, expectedStatuses: [200] })
    const marker = response.headers.get(CHECK_HEADER) || ''
    return { ok: response.ok && marker === CHECK_VALUE, observed: { status: response.status, marker: marker || null } }
  } catch (error) {
    return { ok: false, observed: { error: error instanceof Error ? error.message : 'public route unavailable' } }
  }
}

const hostnameReady = (hostname: CloudflareCustomHostname | null) => Boolean(hostname && HOSTNAME_ACTIVE_STATUSES.has(String(hostname.status || '')))
const sslActive = (hostname: CloudflareCustomHostname | null) => String(hostname?.ssl?.status || '') === 'active'

const sslErrors = (hostname: CloudflareCustomHostname | null): string[] => {
  const errors: string[] = []
  for (const item of Array.isArray(hostname?.ssl?.validation_errors) ? hostname!.ssl!.validation_errors! : []) {
    if (typeof item === 'string' && item) errors.push(item)
    else if (item && typeof item === 'object' && item.message) errors.push(item.message)
  }
  return errors
}

let cachedHealth: { at: number; value: DomainProviderHealth } | null = null

const getTlsStatus = async (input: DomainProviderInput): Promise<DomainTlsResult> => {
  const [apex, www] = await getPair(input)
  const registered = Boolean(apex && www)
  const requireApex = apexRequired()
  const wwwActive = sslActive(www)
  const apexActive = sslActive(apex)
  const active = registered && wwwActive && (!requireApex || apexActive)
  const requiredFailures = requireApex ? [apex, www] : [www]
  const failed = !registered || requiredFailures.some((item) => SSL_FAILURE_STATUSES.has(String(item?.ssl?.status || '')))
  const statuses = {
    mode: requireApex ? 'apex_and_www' : 'www_required_apex_optional',
    apex: { hostname: apex?.hostname || input.domain, required: requireApex, status: apex?.status || 'missing', sslStatus: apex?.ssl?.status || 'missing', errors: sslErrors(apex) },
    www: { hostname: www?.hostname || `www.${input.domain}`, required: true, status: www?.status || 'missing', sslStatus: www?.ssl?.status || 'missing', errors: sslErrors(www) },
  }
  const status: DomainTlsResult['status'] = active ? 'active' : failed ? 'failed' : 'provisioning'
  const message = !registered
    ? 'Cloudflare custom-hostname registration is incomplete'
    : failed
      ? 'Cloudflare certificate issuance failed or timed out for a required hostname; review the SSL validation records and validation errors'
      : undefined
  return {
    status,
    canonicalHost: canonicalFor(input.domain, requireApex && apexActive),
    providerMetadata: metadataFor([apex, www]),
    diagnostics: [diagnostic('tls_certificate', 'Cloudflare SSL for SaaS certificate', active, {
      expected: requireApex ? 'Cloudflare ssl.status=active for apex and www' : 'Cloudflare ssl.status=active for www; apex is optional',
      observed: statuses,
      state: active ? 'pass' : failed ? 'failed' : 'pending',
      ...(message ? { message } : {}),
    })],
  }
}

export const CloudflareDomainProvider: DomainProvider = {
  name: 'cloudflare',

  async registerDomain(input) {
    requireConfigured()
    const [apexName, wwwName] = hostnamePair(input.domain)
    const apex = await createOne(apexName, input, 'apex')
    try {
      const www = await createOne(wwwName, input, 'www')
      const providerRequestId = String(apex.hostname.id || www.hostname.id || '')
      return {
        registered: true,
        ...(providerRequestId ? { providerRequestId } : {}),
        providerMetadata: metadataFor([apex.hostname, www.hostname]),
      }
    } catch (error) {
      // If this request created the apex but www failed, remove only what this
      // request created so retries cannot leave a half-registered domain pair.
      if (apex.created && apex.hostname.id) await deleteOneById(apex.hostname.id).catch(() => undefined)
      throw error
    }
  },

  async getRequiredDns(input): Promise<RequiredDnsRecord[]> {
    requireConfigured()
    const [apex, www] = await getPair(input)
    if (!apex || !www) throw new ApiError(502, 'Cloudflare custom-hostname registration is incomplete; retry registration before changing DNS')
    const target = normalizeTarget(config.domains.cloudflare_saas_cname_target)
    return [
      {
        type: 'TXT',
        name: `${config.domains.ownership_prefix}.${input.domain}`,
        host: config.domains.ownership_prefix,
        value: `realestate-saas=${input.ownershipToken}`,
        purpose: 'ownership',
        source: 'opygen_ownership',
        required: true,
      },
      {
        type: 'CNAME',
        name: input.domain,
        host: '@',
        value: target,
        purpose: 'routing',
        source: 'cloudflare_routing',
        rank: 1,
        required: apexRequired(),
        note: apexRequired()
          ? 'Required because CLOUDFLARE_APEX_ROUTING_MODE=required.'
          : 'Optional on the cost-effective setup. Use CNAME flattening, ALIAS, or ANAME if your DNS provider supports it; otherwise www becomes canonical.',
      },
      {
        type: 'CNAME',
        name: `www.${input.domain}`,
        host: 'www',
        value: target,
        purpose: 'routing',
        source: 'cloudflare_routing',
        rank: 1,
        required: true,
        note: 'Recommended universal routing: point www to the Opygen SaaS CNAME target.',
      },
      ...validationRecords(input, [apex, www]),
    ]
  },

  async verifyRouting(input): Promise<DomainRoutingResult> {
    requireConfigured()
    const [apexName, wwwName] = hostnamePair(input.domain)
    const [apex, www, targetDns, apexDns, wwwDns] = await Promise.all([
      getCurrentCustomHostname(apexName),
      getCurrentCustomHostname(wwwName),
      resolveDns(config.domains.cloudflare_saas_cname_target),
      resolveDns(apexName),
      resolveDns(wwwName),
    ])

    const registered = Boolean(apex && www)
    const requireApex = apexRequired()
    const apexVerified = hostnameReady(apex)
    const wwwVerified = hostnameReady(www)
    const apexOk = matchesSaasTarget(apexDns, targetDns, config.domains.cloudflare_saas_cname_target)
    const wwwOk = matchesSaasTarget(wwwDns, targetDns, config.domains.cloudflare_saas_cname_target)
    const providerVerified = wwwVerified && (!requireApex || apexVerified)
    const routingReady = wwwOk && (!requireApex || apexOk)
    const canonicalHost = canonicalFor(input.domain, apexOk && apexVerified)
    const providerObserved = {
      apex: { id: apex?.id || null, status: apex?.status || 'missing', verificationErrors: apex?.verification_errors || [] },
      www: { id: www?.id || null, status: www?.status || 'missing', verificationErrors: www?.verification_errors || [] },
    }

    return {
      apexOk,
      wwwOk,
      registered,
      providerVerified,
      routingReady,
      canonicalHost,
      providerMetadata: metadataFor([apex, www]),
      diagnostics: [
        diagnostic('apex_a', 'Apex Cloudflare for SaaS routing', apexOk || !requireApex, {
          expected: { cnameTarget: normalizeTarget(config.domains.cloudflare_saas_cname_target), flatteningAllowed: true, required: requireApex },
          observed: apexDns,
          state: apexOk || !requireApex ? 'pass' : 'pending',
          ...(!apexOk ? { message: requireApex
            ? `Point the apex/root hostname to ${normalizeTarget(config.domains.cloudflare_saas_cname_target)} using CNAME, ALIAS/ANAME, or supported CNAME flattening`
            : `Apex routing is optional on this plan. If your DNS provider cannot flatten a root CNAME, keep www pointed to ${normalizeTarget(config.domains.cloudflare_saas_cname_target)} and Opygen will use www as canonical.` } : {}),
        }),
        diagnostic('www_cname', 'www Cloudflare for SaaS routing', wwwOk, {
          expected: { cnameTarget: normalizeTarget(config.domains.cloudflare_saas_cname_target) },
          observed: wwwDns,
          state: wwwOk ? 'pass' : 'pending',
          ...(!wwwOk ? { message: `Point www CNAME to ${normalizeTarget(config.domains.cloudflare_saas_cname_target)}` } : {}),
        }),
        diagnostic('hosting_registration', 'Cloudflare custom-hostname validation', registered && providerVerified, {
          expected: requireApex ? 'Apex and www registered with Cloudflare and hostname status active' : 'www hostname active; apex validation is optional',
          observed: providerObserved,
          state: registered && providerVerified ? 'pass' : 'pending',
          ...(!registered
            ? { message: 'Apex and www must both exist as Cloudflare for SaaS Custom Hostnames' }
            : !providerVerified
              ? { message: requireApex
                ? 'Cloudflare hostname ownership validation is pending. Add every required Cloudflare hostname-validation record shown in Required DNS records.'
                : 'Cloudflare www hostname validation is pending. Add the required www validation records; apex validation is optional.' }
              : {}),
        }),
      ],
    }
  },

  async provisionTls(input): Promise<DomainTlsResult> {
    // Cloudflare starts certificate issuance when each Custom Hostname is created.
    // With TXT DCV, there is no separate certificate-create call; the provider
    // lifecycle is represented by ssl.status and ssl.validation_records.
    return getTlsStatus(input)
  },

  getTlsStatus,

  async verifyPublicRouting(input): Promise<DomainPublicRoutingResult> {
    requireConfigured()
    const [apex, www] = await Promise.all([verifyPublicHost(input.domain), verifyPublicHost(`www.${input.domain}`)])
    const requireApex = apexRequired()
    const active = www.ok && (!requireApex || apex.ok)
    const canonicalHost = canonicalFor(input.domain, apex.ok)
    return {
      active,
      canonicalHost,
      diagnostics: [diagnostic('public_routing', 'Cloudflare public routing', active, {
        expected: requireApex ? `${CHECK_HEADER}: ${CHECK_VALUE} on apex and www` : `${CHECK_HEADER}: ${CHECK_VALUE} on www; apex optional`,
        observed: { apex: apex.observed, www: www.observed, canonicalHost },
        state: active ? 'pass' : 'pending',
        ...(!active ? { message: requireApex
          ? 'Cloudflare is not yet serving the Opygen runtime for both hostnames; DNS propagation, Worker routing, or certificate deployment may still be pending'
          : 'Cloudflare is not yet serving the Opygen runtime on www; apex may remain unset when the customer DNS provider cannot flatten root CNAMEs' } : {}),
      })],
    }
  },

  async removeDomain(domain: string) {
    requireConfigured()
    const [apexName, wwwName] = hostnamePair(domain)
    const results = await Promise.allSettled([removeOne(apexName), removeOne(wwwName)])
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (rejected) throw rejected.reason
  },

  async hasDomain(domain: string) {
    requireConfigured()
    const [apexName, wwwName] = hostnamePair(domain)
    const [apex, www] = await Promise.all([findCustomHostname(apexName), findCustomHostname(wwwName)])
    return Boolean(apex || www)
  },

  async health(force = false): Promise<DomainProviderHealth> {
    const now = Date.now()
    if (!force && cachedHealth && now - cachedHealth.at < config.domains.provider_health_cache_ms) return cachedHealth.value
    const started = performance.now()

    if (!providerConfigured()) {
      const value: DomainProviderHealth = {
        provider: 'cloudflare',
        configured: false,
        healthy: false,
        latencyMs: 0,
        detail: 'not_configured',
        checkedAt: new Date().toISOString(),
      }
      cachedHealth = { at: now, value }
      return value
    }

    try {
      const listUrl = new URL(customHostnamesUrl())
      listUrl.searchParams.set('page', '1')
      listUrl.searchParams.set('per_page', '5')
      const [zoneResponse, hostnamesResponse, fallbackResponse, targetDns] = await Promise.all([
        cloudflareFetch('cloudflare-zone-health', zoneApiUrl(), { method: 'GET' }, [200, 401, 403, 404]),
        cloudflareFetch('cloudflare-saas-health', listUrl.toString(), { method: 'GET' }, [200, 401, 403, 404]),
        cloudflareFetch('cloudflare-fallback-origin-health', customHostnamesUrl('/fallback_origin'), { method: 'GET' }, [200, 404]),
        resolveDns(config.domains.cloudflare_saas_cname_target),
      ])
      const [zonePayload, hostnamesPayload, fallbackPayload] = await Promise.all([
        parseEnvelope<CloudflareZone>(zoneResponse),
        parseEnvelope<CloudflareCustomHostname[]>(hostnamesResponse),
        parseEnvelope<CloudflareFallbackOrigin>(fallbackResponse),
      ])
      const zone = zonePayload.result
      const fallback = fallbackPayload.result
      const accountMatches = Boolean(zone?.account?.id && zone.account.id === config.domains.cloudflare_account_id)
      const fallbackMatches = Boolean(
        fallbackResponse.ok
        && fallback?.origin
        && normalizeTarget(fallback.origin) === normalizeTarget(config.domains.cloudflare_saas_fallback_origin)
        && fallback.status === 'active',
      )
      const customHostnamesAccess = Boolean(hostnamesResponse.ok && hostnamesPayload.success !== false)
      const targetResolvable = targetDns.cnames.length + targetDns.ipv4.length + targetDns.ipv6.length > 0
      const healthy = Boolean(zoneResponse.ok && accountMatches && customHostnamesAccess && fallbackMatches && targetResolvable)
      const detailParts: string[] = []
      if (!zoneResponse.ok) detailParts.push(`zone_lookup_${zoneResponse.status}`)
      else if (!accountMatches) detailParts.push('zone_account_mismatch')
      if (!customHostnamesAccess) detailParts.push(`custom_hostnames_${hostnamesResponse.status}`)
      if (!fallbackResponse.ok) detailParts.push(`fallback_origin_${fallbackResponse.status}`)
      else if (!fallbackMatches) detailParts.push(`fallback_origin_${fallback?.status || 'mismatch'}`)
      if (!targetResolvable) detailParts.push('cname_target_unresolvable')

      const value: DomainProviderHealth = {
        provider: 'cloudflare',
        configured: true,
        healthy,
        latencyMs: Math.round(performance.now() - started),
        ...(detailParts.length ? { detail: detailParts.join(',') } : {}),
        checkedAt: new Date().toISOString(),
      }
      cachedHealth = { at: now, value }
      return value
    } catch (error) {
      const value: DomainProviderHealth = {
        provider: 'cloudflare',
        configured: true,
        healthy: false,
        latencyMs: Math.round(performance.now() - started),
        detail: error instanceof Error ? error.message.slice(0, 240) : 'provider_unreachable',
        checkedAt: new Date().toISOString(),
      }
      cachedHealth = { at: now, value }
      return value
    }
  },
}
