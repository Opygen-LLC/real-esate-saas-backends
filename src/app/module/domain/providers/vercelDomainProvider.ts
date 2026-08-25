import dns from 'dns/promises'
import tls from 'tls'
import ApiError from '../../../../errors/ApiError'
import config from '../../../../config'
import { Resilience } from '../../../../shared/resilience'
import type {
  DomainDiagnostic,
  DomainProvider,
  DomainProviderHealth,
  DomainProviderInput,
  DomainPublicRoutingResult,
  DomainRoutingResult,
  DomainTlsResult,
  RequiredDnsRecord,
} from './domainProvider'

const CHECK_PATH = '/.well-known/opygen-domain-check'
const CHECK_HEADER = 'x-opygen-domain-check'
const CHECK_VALUE = 'real-estate-saas'

type VercelDomainConfig = {
  configuredBy?: string | null
  misconfigured?: boolean
  recommendedIPv4?: Array<{ rank?: number; value?: string[] | string }>
  recommendedCNAME?: Array<{ rank?: number; value?: string[] | string }>
}

type VercelProjectDomain = Record<string, unknown> & {
  name?: string
  id?: string
  verified?: boolean
  verification?: Array<{
    type?: string
    domain?: string
    name?: string
    value?: string
    reason?: string
  }>
}

type VercelVerificationAttempt = {
  domain: string
  status: number
  payload: Record<string, unknown>
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

const projectUrl = (suffix = '') => {
  const base = `${config.domains.vercel_api_base.replace(/\/$/, '')}/v9/projects/${encodeURIComponent(config.domains.vercel_project)}`
  const url = new URL(`${base}${suffix}`)
  if (config.domains.vercel_team_id) url.searchParams.set('teamId', config.domains.vercel_team_id)
  return url.toString()
}

const domainsApiUrl = (version: string, path: string) => {
  const url = new URL(`${config.domains.vercel_api_base.replace(/\/$/, '')}/${version}${path}`)
  if (config.domains.vercel_team_id) url.searchParams.set('teamId', config.domains.vercel_team_id)
  return url.toString()
}

const domainConfigUrl = (domain: string) => {
  const url = new URL(`${config.domains.vercel_api_base.replace(/\/$/, '')}/v6/domains/${encodeURIComponent(domain)}/config`)
  url.searchParams.set('projectIdOrName', config.domains.vercel_project)
  url.searchParams.set('strict', 'true')
  if (config.domains.vercel_team_id) url.searchParams.set('teamId', config.domains.vercel_team_id)
  return url.toString()
}

const providerHeaders = () => ({
  authorization: `Bearer ${config.domains.vercel_api_token}`,
  'content-type': 'application/json',
})

const providerConfigured = () => Boolean(
  config.domains.provider === 'vercel'
  && config.domains.vercel_project
  && config.domains.vercel_api_token
  && (!config.domains.vercel_require_team_id || config.domains.vercel_team_id),
)

const requireConfigured = () => {
  if (!providerConfigured()) throw new ApiError(503, 'Custom-domain provider is not fully configured')
}

const providerFetch = async (service: string, url: string, init: RequestInit = {}, expectedStatuses?: number[]) => {
  requireConfigured()
  const headers = new Headers(init.headers || {})
  for (const [key, value] of Object.entries(providerHeaders())) {
    if (!headers.has(key)) headers.set(key, value)
  }
  return Resilience.fetch(service, url, {
    ...init,
    headers,
  }, {
    timeoutMs: config.domains.provider_timeout_ms,
    ...(expectedStatuses ? { expectedStatuses } : {}),
  })
}

const getProjectDomain = async (domain: string): Promise<VercelProjectDomain | null> => {
  const response = await providerFetch(
    'vercel-domain-project',
    projectUrl(`/domains/${encodeURIComponent(domain)}`),
    { method: 'GET' },
    [200, 404],
  )
  if (response.status === 404) return null
  if (!response.ok) throw new ApiError(502, `Vercel project-domain lookup failed (${response.status})`)
  return response.json().catch(() => ({})) as Promise<VercelProjectDomain>
}

const getDomainConfig = async (domain: string): Promise<VercelDomainConfig> => {
  const response = await providerFetch(
    'vercel-domain-config',
    domainConfigUrl(domain),
    { method: 'GET' },
    [200, 400, 404],
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as any
    const detail = payload?.error?.message || payload?.message || `status ${response.status}`
    throw new ApiError(502, `Vercel domain configuration lookup failed for ${domain}: ${detail}`)
  }
  return response.json().catch(() => ({})) as Promise<VercelDomainConfig>
}

const selectRecommendedIPv4 = (payload: VercelDomainConfig): string[] => {
  const rows = Array.isArray(payload.recommendedIPv4) ? payload.recommendedIPv4 : []
  const sorted = [...rows].sort((a, b) => Number(a.rank ?? 999) - Number(b.rank ?? 999))
  const bestRank = sorted.length ? Number(sorted[0]?.rank ?? 999) : null
  if (bestRank === null) return []
  return sorted
    .filter((row) => Number(row.rank ?? 999) === bestRank)
    .flatMap((row) => Array.isArray(row.value) ? row.value : [row.value])
    .map((value) => String(value || '').trim())
    .filter((value) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value))
}

const selectRecommendedCname = (payload: VercelDomainConfig): string => {
  const rows = Array.isArray(payload.recommendedCNAME) ? payload.recommendedCNAME : []
  const sorted = [...rows].sort((a, b) => Number(a.rank ?? 999) - Number(b.rank ?? 999))
  const raw = sorted[0]?.value
  const candidate = Array.isArray(raw) ? raw[0] : raw
  return normalizeTarget(String(candidate || ''))
}

const recommendedRouting = async (input: DomainProviderInput) => {
  if (!providerConfigured() && !config.isProduction) {
    if (!config.domains.a_target || !config.domains.cname_target) throw new ApiError(503, 'Development DNS routing targets are not configured')
    return {
      apexCandidates: [config.domains.a_target],
      apexPreferred: config.domains.a_target,
      cnamePreferred: normalizeTarget(config.domains.cname_target),
      apexConfig: { misconfigured: false, configuredBy: 'development' } as VercelDomainConfig,
      wwwConfig: { misconfigured: false, configuredBy: 'development' } as VercelDomainConfig,
    }
  }

  const [apexConfig, wwwConfig] = await Promise.all([
    getDomainConfig(input.domain),
    getDomainConfig(`www.${input.domain}`),
  ])
  const apexCandidates = selectRecommendedIPv4(apexConfig)
  const cnamePreferred = selectRecommendedCname(wwwConfig)
  if (!apexCandidates.length || !cnamePreferred) {
    throw new ApiError(502, 'Vercel did not return recommended DNS routing records for this project/domain')
  }
  return {
    apexCandidates,
    apexPreferred: apexCandidates[0],
    cnamePreferred,
    apexConfig,
    wwwConfig,
  }
}

const providerVerificationRecords = (input: DomainProviderInput, domains: Array<VercelProjectDomain | null>): RequiredDnsRecord[] => {
  const records: RequiredDnsRecord[] = []
  for (const projectDomain of domains) {
    const challenges = Array.isArray(projectDomain?.verification) ? projectDomain.verification : []
    for (const challenge of challenges) {
      const type = String(challenge?.type || '').toUpperCase()
      if (!['TXT', 'CNAME'].includes(type)) continue
      const name = normalizeTarget(String(challenge?.domain || challenge?.name || input.domain))
      const value = String(challenge?.value || '').trim()
      if (!name || !value) continue
      const host = name === input.domain ? '@' : name.endsWith(`.${input.domain}`) ? name.slice(0, -(input.domain.length + 1)) : name
      records.push({
        type: type as 'TXT' | 'CNAME',
        name,
        host,
        value,
        purpose: 'provider_verification',
        source: 'vercel_project_verification',
      })
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

const registerOne = async (domain: string): Promise<{ payload: VercelProjectDomain; created: boolean }> => {
  const existing = await getProjectDomain(domain)
  if (existing) return { payload: existing, created: false }

  const response = await providerFetch(
    'vercel-domain-register',
    domainsApiUrl('v10', `/projects/${encodeURIComponent(config.domains.vercel_project)}/domains`),
    { method: 'POST', body: JSON.stringify({ name: domain }) },
    [200, 201, 400, 409],
  )
  if (response.ok) {
    return {
      payload: await response.json().catch(() => ({})) as VercelProjectDomain,
      created: true,
    }
  }

  // The add operation is idempotent. A race can return a conflict even though
  // another request attached the same hostname to this project moments earlier.
  const racedExisting = await getProjectDomain(domain)
  if (racedExisting) return { payload: racedExisting, created: false }

  const payload = await response.json().catch(() => ({})) as any
  throw new ApiError(
    response.status === 409 ? 409 : 502,
    payload?.error?.message || payload?.message || `Vercel could not attach ${domain} to the configured project`,
  )
}

const removeOne = async (domain: string) => {
  const response = await providerFetch(
    'vercel-domain-remove',
    projectUrl(`/domains/${encodeURIComponent(domain)}`),
    { method: 'DELETE' },
    [200, 204, 404],
  )
  if (![200, 204, 404].includes(response.status)) throw new ApiError(502, `Vercel domain removal failed (${response.status})`)
}

const triggerProjectDomainVerification = async (domain: string): Promise<VercelVerificationAttempt> => {
  const response = await providerFetch(
    'vercel-domain-verify',
    projectUrl(`/domains/${encodeURIComponent(domain)}/verify`),
    { method: 'POST' },
    [200, 400, 404, 409],
  )
  return {
    domain,
    status: response.status,
    payload: await response.json().catch(() => ({})) as Record<string, unknown>,
  }
}

const refreshProjectVerification = async (domains: [string, string]) => {
  let projectDomains: [VercelProjectDomain | null, VercelProjectDomain | null] = await Promise.all([
    getProjectDomain(domains[0]),
    getProjectDomain(domains[1]),
  ])

  const attempts: VercelVerificationAttempt[] = []
  await Promise.all(projectDomains.map(async (projectDomain, index) => {
    if (!projectDomain || projectDomain.verified) return
    attempts[index] = await triggerProjectDomainVerification(domains[index])
  }))

  if (attempts.some(Boolean)) {
    projectDomains = await Promise.all([
      getProjectDomain(domains[0]),
      getProjectDomain(domains[1]),
    ])
  }

  return { projectDomains, attempts: attempts.filter(Boolean) }
}

const resolveA = async (name: string) => {
  try { return await dns.resolve4(name) } catch { return [] }
}

const resolveCname = async (name: string) => {
  try { return (await dns.resolveCname(name)).map(normalizeTarget) } catch { return [] }
}

const verifyTlsHost = async (host: string): Promise<{ ok: boolean; detail: string }> => new Promise((resolve) => {
  let settled = false
  const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true })
  const finish = (ok: boolean, detail: string) => {
    if (settled) return
    settled = true
    socket.destroy()
    resolve({ ok, detail })
  }
  socket.setTimeout(config.domains.provider_timeout_ms)
  socket.once('secureConnect', () => {
    const cert = socket.getPeerCertificate()
    const authorizationError = socket.authorizationError
    const authorizationDetail = authorizationError instanceof Error
      ? authorizationError.message
      : authorizationError || 'certificate not authorized'
    finish(
      socket.authorized,
      socket.authorized ? `valid certificate: ${cert.subject?.CN || host}` : authorizationDetail,
    )
  })
  socket.once('timeout', () => finish(false, 'TLS handshake timed out'))
  socket.once('error', (error) => finish(false, error.message))
})

const verifyPublicHost = async (host: string) => {
  try {
    const response = await Resilience.fetch('vercel-domain-public-route', `https://${host}${CHECK_PATH}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'manual',
    }, { timeoutMs: config.domains.provider_timeout_ms, expectedStatuses: [200] })
    const header = response.headers.get(CHECK_HEADER) || ''
    return { ok: response.ok && header === CHECK_VALUE, observed: { status: response.status, marker: header || null } }
  } catch (error) {
    return { ok: false, observed: { error: error instanceof Error ? error.message : 'public route unavailable' } }
  }
}

let cachedHealth: { at: number; value: DomainProviderHealth } | null = null

const getTlsStatus = async (input: DomainProviderInput): Promise<DomainTlsResult> => {
  if (!providerConfigured() && !config.isProduction) {
    return { status: 'provisioning', diagnostics: [diagnostic('tls_certificate', 'TLS certificate', false, { expected: 'Vercel-managed TLS', observed: 'development provider credentials not configured' })] }
  }
  const [apex, www] = await Promise.all([verifyTlsHost(input.domain), verifyTlsHost(`www.${input.domain}`)])
  const active = apex.ok && www.ok
  return {
    status: active ? 'active' : 'provisioning',
    diagnostics: [diagnostic('tls_certificate', 'TLS certificate', active, {
      expected: 'Valid Vercel-managed HTTPS certificate for apex and www',
      observed: { apex: apex.detail, www: www.detail },
      state: active ? 'pass' : 'pending',
    })],
  }
}

export const VercelDomainProvider: DomainProvider = {
  name: 'vercel',

  async getRequiredDns(input): Promise<RequiredDnsRecord[]> {
    const baseRecords: RequiredDnsRecord[] = [{
      type: 'TXT',
      name: `${config.domains.ownership_prefix}.${input.domain}`,
      host: config.domains.ownership_prefix,
      value: `realestate-saas=${input.ownershipToken}`,
      purpose: 'ownership',
      source: 'opygen_ownership',
    }]

    if (!providerConfigured() && !config.isProduction) {
      const routing = await recommendedRouting(input)
      return [
        ...baseRecords,
        { type: 'A', name: input.domain, host: '@', value: routing.apexPreferred, purpose: 'routing', source: 'development_fallback', rank: 1 },
        { type: 'CNAME', name: `www.${input.domain}`, host: 'www', value: routing.cnamePreferred, purpose: 'routing', source: 'development_fallback', rank: 1 },
      ]
    }

    const [routing, projectDomains] = await Promise.all([
      recommendedRouting(input),
      Promise.all([getProjectDomain(input.domain), getProjectDomain(`www.${input.domain}`)]),
    ])
    return [
      ...baseRecords,
      { type: 'A', name: input.domain, host: '@', value: routing.apexPreferred, purpose: 'routing', source: 'vercel_recommended', rank: 1 },
      { type: 'CNAME', name: `www.${input.domain}`, host: 'www', value: routing.cnamePreferred, purpose: 'routing', source: 'vercel_recommended', rank: 1 },
      ...providerVerificationRecords(input, projectDomains),
    ]
  },

  async registerDomain(input) {
    if (!providerConfigured() && !config.isProduction) return { registered: true, providerRequestId: 'development-manual' }

    const apex = await registerOne(input.domain)
    try {
      const www = await registerOne(`www.${input.domain}`)
      const requestId = String(apex.payload?.id || www.payload?.id || '')
      return { registered: true, ...(requestId ? { providerRequestId: requestId } : {}) }
    } catch (error) {
      // Avoid leaving a partial registration when this request created the apex
      // but the www hostname could not be attached (for example, ownership conflict).
      if (apex.created) await removeOne(input.domain).catch(() => undefined)
      throw error
    }
  },

  async verifyRouting(input): Promise<DomainRoutingResult> {
    const domains: [string, string] = [input.domain, `www.${input.domain}`]
    const [routing, addresses, cnames, verification] = await Promise.all([
      recommendedRouting(input),
      resolveA(input.domain),
      resolveCname(`www.${input.domain}`),
      !providerConfigured() && !config.isProduction
        ? Promise.resolve({
          projectDomains: [{ verified: true, development: true }, { verified: true, development: true }] as [VercelProjectDomain, VercelProjectDomain],
          attempts: [] as VercelVerificationAttempt[],
        })
        : refreshProjectVerification(domains),
    ])

    const [apexProjectDomain, wwwProjectDomain] = verification.projectDomains
    const apexOk = addresses.some((address) => routing.apexCandidates.includes(address))
    const wwwOk = cnames.includes(routing.cnamePreferred)
    const registered = Boolean(apexProjectDomain && wwwProjectDomain)
    const providerVerified = Boolean(apexProjectDomain?.verified && wwwProjectDomain?.verified)

    return {
      apexOk,
      wwwOk,
      registered,
      providerVerified,
      diagnostics: [
        diagnostic('apex_a', 'A / apex routing', apexOk, {
          expected: { recommended: routing.apexCandidates, source: 'Vercel domain configuration API' },
          observed: { addresses, configuredBy: routing.apexConfig.configuredBy ?? null, misconfigured: routing.apexConfig.misconfigured ?? null },
          state: apexOk ? 'pass' : 'pending',
        }),
        diagnostic('www_cname', 'www routing', wwwOk, {
          expected: { recommended: routing.cnamePreferred, source: 'Vercel domain configuration API' },
          observed: { cnames, configuredBy: routing.wwwConfig.configuredBy ?? null, misconfigured: routing.wwwConfig.misconfigured ?? null },
          state: wwwOk ? 'pass' : 'pending',
        }),
        diagnostic('hosting_registration', 'Vercel project registration', registered && providerVerified, {
          expected: `Apex and www attached to and verified on Vercel project ${config.domains.vercel_project}`,
          observed: {
            apex: apexProjectDomain ? { registered: true, verified: Boolean(apexProjectDomain.verified) } : { registered: false, verified: false },
            www: wwwProjectDomain ? { registered: true, verified: Boolean(wwwProjectDomain.verified) } : { registered: false, verified: false },
            verificationAttempts: verification.attempts.map((attempt) => ({ domain: attempt.domain, status: attempt.status })),
          },
          ...(!registered
            ? { message: 'Domain is not registered on the configured Vercel project', state: 'pending' as const }
            : !providerVerified
              ? { message: 'Vercel ownership verification is pending. Add every provider-verification DNS record shown below, then check again.', state: 'pending' as const }
              : {}),
        }),
      ],
    }
  },

  async provisionTls(input): Promise<DomainTlsResult> {
    if (!providerConfigured() && !config.isProduction) {
      return { status: 'provisioning', diagnostics: [diagnostic('tls_certificate', 'TLS certificate', false, { expected: 'Vercel-managed TLS', observed: 'development provider credentials not configured' })] }
    }

    // Explicitly invoking Vercel's verification endpoint is important for API-
    // managed domains: it refreshes domain access verification and kicks the
    // managed certificate lifecycle without requiring a dashboard visit.
    const verification = await Promise.all([
      triggerProjectDomainVerification(input.domain),
      triggerProjectDomainVerification(`www.${input.domain}`),
    ])
    const missing = verification.find((item) => item.status === 404)
    if (missing) {
      return {
        status: 'failed',
        diagnostics: [diagnostic('tls_certificate', 'TLS certificate', false, {
          expected: 'Vercel-managed TLS',
          observed: verification.map((item) => ({ domain: item.domain, status: item.status })),
          message: 'Domain is missing from the configured Vercel project',
        })],
      }
    }
    return getTlsStatus(input)
  },

  getTlsStatus,

  async verifyPublicRouting(input): Promise<DomainPublicRoutingResult> {
    if (!providerConfigured() && !config.isProduction) {
      return { active: false, diagnostics: [diagnostic('public_routing', 'Public routing', false, { expected: 'Opygen website runtime', observed: 'development provider credentials not configured' })] }
    }
    const [apex, www] = await Promise.all([verifyPublicHost(input.domain), verifyPublicHost(`www.${input.domain}`)])
    const active = apex.ok && www.ok
    return {
      active,
      diagnostics: [diagnostic('public_routing', 'Public routing', active, {
        expected: `${CHECK_HEADER}: ${CHECK_VALUE}`,
        observed: { apex: apex.observed, www: www.observed },
        state: active ? 'pass' : 'pending',
      })],
    }
  },

  async removeDomain(domain: string) {
    if (!providerConfigured()) throw new ApiError(503, 'Vercel domain provider is not configured')
    const results = await Promise.allSettled([removeOne(domain), removeOne(`www.${domain}`)])
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (rejected) throw rejected.reason
  },

  async hasDomain(domain: string) {
    if (!providerConfigured()) throw new ApiError(503, 'Vercel domain provider is not configured')
    const [apex, www] = await Promise.all([getProjectDomain(domain), getProjectDomain(`www.${domain}`)])
    return Boolean(apex || www)
  },

  async health(force = false): Promise<DomainProviderHealth> {
    const now = Date.now()
    if (!force && cachedHealth && now - cachedHealth.at < config.domains.provider_health_cache_ms) return cachedHealth.value
    const started = performance.now()
    if (!providerConfigured()) {
      const value = { provider: 'vercel', configured: false, healthy: false, latencyMs: 0, detail: 'not_configured', checkedAt: new Date().toISOString() }
      cachedHealth = { at: now, value }
      return value
    }
    try {
      const response = await providerFetch('vercel-domain-health', projectUrl(), { method: 'GET' }, [200, 401, 403, 404])
      const healthy = response.ok
      const value = {
        provider: 'vercel',
        configured: true,
        healthy,
        latencyMs: Math.round(performance.now() - started),
        ...(healthy ? {} : { detail: `project_lookup_${response.status}` }),
        checkedAt: new Date().toISOString(),
      }
      cachedHealth = { at: now, value }
      return value
    } catch (error) {
      const value = {
        provider: 'vercel',
        configured: true,
        healthy: false,
        latencyMs: Math.round(performance.now() - started),
        detail: error instanceof Error ? error.message.slice(0, 160) : 'provider_unreachable',
        checkedAt: new Date().toISOString(),
      }
      cachedHealth = { at: now, value }
      return value
    }
  },
}
