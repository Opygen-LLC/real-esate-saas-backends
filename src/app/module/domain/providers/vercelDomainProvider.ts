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

const diagnostic = (
  check: DomainDiagnostic['check'],
  label: string,
  ok: boolean,
  options: Pick<DomainDiagnostic, 'expected' | 'observed' | 'message'> & Partial<Pick<DomainDiagnostic, 'state'>> = {},
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

const providerHeaders = () => ({
  authorization: `Bearer ${config.domains.vercel_api_token}`,
  'content-type': 'application/json',
})

const providerConfigured = () => Boolean(
  config.domains.provider === 'vercel'
  && config.domains.vercel_project
  && config.domains.vercel_api_token
  && config.domains.a_target
  && config.domains.cname_target,
)

const requireConfigured = () => {
  if (!providerConfigured()) throw new ApiError(503, 'Custom-domain provider is not fully configured')
}

const requireRoutingTargets = () => {
  if (!config.domains.a_target || !config.domains.cname_target) throw new ApiError(503, 'Custom-domain DNS targets are not configured')
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

const getProjectDomain = async (domain: string) => {
  const response = await providerFetch(
    'vercel-domain-project',
    projectUrl(`/domains/${encodeURIComponent(domain)}`),
    { method: 'GET' },
    [200, 404],
  )
  if (response.status === 404) return null
  if (!response.ok) throw new ApiError(502, `Vercel project-domain lookup failed (${response.status})`)
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>
}

const providerVerificationRecords = (input: DomainProviderInput, domains: Array<Record<string, unknown> | null>): RequiredDnsRecord[] => {
  const records: RequiredDnsRecord[] = []
  for (const projectDomain of domains) {
    const challenges = Array.isArray((projectDomain as any)?.verification) ? (projectDomain as any).verification : []
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

const registerOne = async (domain: string) => {
  const response = await providerFetch(
    'vercel-domain-register',
    domainsApiUrl('v10', `/projects/${encodeURIComponent(config.domains.vercel_project)}/domains`),
    { method: 'POST', body: JSON.stringify({ name: domain }) },
    [200, 201, 400, 409],
  )
  if (response.ok) return response.json().catch(() => ({})) as Promise<Record<string, unknown>>

  // Vercel may return a conflict for an idempotent re-add. Only accept that
  // case when the domain is actually attached to this configured project.
  const existing = await getProjectDomain(domain)
  if (existing) return existing
  const payload = await response.json().catch(() => ({})) as any
  throw new ApiError(409, payload?.error?.message || payload?.message || `Domain ${domain} is attached to another Vercel project or account`)
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
    finish(socket.authorized, socket.authorized ? `valid certificate: ${cert.subject?.CN || host}` : (socket.authorizationError || 'certificate not authorized'))
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
      expected: 'Valid HTTPS certificate for apex and www',
      observed: { apex: apex.detail, www: www.detail },
    })],
  }
}

export const VercelDomainProvider: DomainProvider = {
  name: 'vercel',

  async getRequiredDns(input): Promise<RequiredDnsRecord[]> {
    requireRoutingTargets()
    const baseRecords: RequiredDnsRecord[] = [
      {
        type: 'TXT',
        name: `${config.domains.ownership_prefix}.${input.domain}`,
        host: config.domains.ownership_prefix,
        value: `realestate-saas=${input.ownershipToken}`,
        purpose: 'ownership',
      },
      { type: 'A', name: input.domain, host: '@', value: config.domains.a_target, purpose: 'routing' },
      { type: 'CNAME', name: `www.${input.domain}`, host: 'www', value: config.domains.cname_target, purpose: 'routing' },
    ]
    if (!providerConfigured() && !config.isProduction) return baseRecords
    const projectDomains = await Promise.all([getProjectDomain(input.domain), getProjectDomain(`www.${input.domain}`)])
    return [...baseRecords, ...providerVerificationRecords(input, projectDomains)]
  },

  async registerDomain(input) {
    if (!providerConfigured() && !config.isProduction) return { registered: true, providerRequestId: 'development-manual' }
    const [apex, www] = await Promise.all([registerOne(input.domain), registerOne(`www.${input.domain}`)])
    const requestId = String((apex as any)?.id || (www as any)?.id || '')
    return { registered: true, ...(requestId ? { providerRequestId: requestId } : {}) }
  },

  async verifyRouting(input): Promise<DomainRoutingResult> {
    requireRoutingTargets()
    const [addresses, cnames] = await Promise.all([
      resolveA(input.domain),
      resolveCname(`www.${input.domain}`),
    ])
    const manualDevelopment = !providerConfigured() && !config.isProduction
    const [apexProjectDomain, wwwProjectDomain] = manualDevelopment
      ? [{ verified: true, development: true }, { verified: true, development: true }]
      : await Promise.all([getProjectDomain(input.domain), getProjectDomain(`www.${input.domain}`)])
    const apexOk = addresses.includes(config.domains.a_target)
    const wwwOk = cnames.includes(normalizeTarget(config.domains.cname_target))
    const registered = Boolean(apexProjectDomain && wwwProjectDomain)
    const providerVerified = Boolean((apexProjectDomain as any)?.verified && (wwwProjectDomain as any)?.verified)
    return {
      apexOk,
      wwwOk,
      registered,
      providerVerified,
      diagnostics: [
        diagnostic('apex_a', 'A / apex routing', apexOk, { expected: config.domains.a_target, observed: addresses }),
        diagnostic('www_cname', 'www routing', wwwOk, { expected: config.domains.cname_target, observed: cnames }),
        diagnostic('hosting_registration', 'Hosting registration', registered && providerVerified, {
          expected: `Registered and verified on Vercel project ${config.domains.vercel_project}`,
          observed: {
            apex: apexProjectDomain ? 'registered' : 'missing',
            www: wwwProjectDomain ? 'registered' : 'missing',
            providerVerified,
          },
          ...(!registered
            ? { message: 'Domain is not registered on the configured Vercel project' }
            : !providerVerified
              ? { message: 'Vercel domain verification is pending; add the provider verification DNS record shown below', state: 'pending' as const }
              : {}),
        }),
      ],
    }
  },

  async provisionTls(input): Promise<DomainTlsResult> {
    if (!providerConfigured() && !config.isProduction) {
      return { status: 'provisioning', diagnostics: [diagnostic('tls_certificate', 'TLS certificate', false, { expected: 'Vercel-managed TLS', observed: 'development provider credentials not configured' })] }
    }
    // Vercel provisions certificates automatically for project domains. Calling
    // the verification endpoints is idempotent and advances any ownership
    // challenge that has already been satisfied.
    const verifyOne = async (domain: string) => {
      const response = await providerFetch(
        'vercel-domain-verify',
        projectUrl(`/domains/${encodeURIComponent(domain)}/verify`),
        { method: 'POST' },
        [200, 400, 404, 409],
      )
      return { status: response.status, payload: await response.json().catch(() => ({})) as Record<string, unknown> }
    }
    const verification = await Promise.all([verifyOne(input.domain), verifyOne(`www.${input.domain}`)])
    const hardFailure = verification.find((item) => item.status === 404)
    if (hardFailure) {
      return {
        status: 'failed',
        diagnostics: [diagnostic('tls_certificate', 'TLS certificate', false, { expected: 'Vercel-managed TLS', observed: verification, message: 'Domain is missing from the configured Vercel project' })],
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
      })],
    }
  },

  async removeDomain(domain: string) {
    if (!providerConfigured()) return
    await Promise.allSettled([removeOne(domain), removeOne(`www.${domain}`)])
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
