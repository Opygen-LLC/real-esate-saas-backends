import dns from 'dns/promises'
import tls from 'tls'
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

/**
 * Generic domain provider — works with ANY hosting provider (Cloudflare, AWS,
 * Nginx, Caddy, etc.).  Uses only public DNS resolution and TLS probing; no
 * external control-plane API is required.
 *
 * Required env vars:
 *   DOMAIN_A_TARGET      — IP address tenants should point their apex A record at
 *   DOMAIN_CNAME_TARGET  — hostname tenants should point their www CNAME at
 *
 * Optional:
 *   DOMAIN_OWNERSHIP_PREFIX — prefix for the TXT ownership record (default: _realestate-verification)
 */

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

const resolveA = async (name: string): Promise<string[]> => {
  try { return await dns.resolve4(name) } catch { return [] }
}

const resolveCname = async (name: string): Promise<string[]> => {
  try { return (await dns.resolveCname(name)).map(normalizeTarget) } catch { return [] }
}

const providerConfigured = (): boolean =>
  Boolean(config.domains.a_target && config.domains.cname_target)

const requireConfigured = (): void => {
  if (!providerConfigured()) {
    throw new Error(
      'Generic domain provider is not fully configured. Set DOMAIN_A_TARGET and DOMAIN_CNAME_TARGET environment variables.',
    )
  }
}

const verifyTlsHost = async (host: string): Promise<{ ok: boolean; detail: string }> =>
  new Promise((resolve) => {
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
      const authError = socket.authorizationError
      const authDetail =
        authError instanceof Error
          ? authError.message
          : authError || 'certificate not authorized'
      finish(
        socket.authorized,
        socket.authorized ? `valid certificate: ${cert.subject?.CN || host}` : authDetail,
      )
    })
    socket.once('timeout', () => finish(false, 'TLS handshake timed out'))
    socket.once('error', (err) => finish(false, err.message))
  })

const verifyPublicHost = async (host: string) => {
  try {
    const response = await Resilience.fetch(
      'generic-domain-public-route',
      `https://${host}${CHECK_PATH}`,
      { method: 'GET', headers: { accept: 'application/json' }, redirect: 'manual' },
      { timeoutMs: config.domains.provider_timeout_ms, expectedStatuses: [200] },
    )
    const header = response.headers.get(CHECK_HEADER) || ''
    return {
      ok: response.ok && header === CHECK_VALUE,
      observed: { status: response.status, marker: header || null },
    }
  } catch (error) {
    return {
      ok: false,
      observed: { error: error instanceof Error ? error.message : 'public route unavailable' },
    }
  }
}

const getTlsStatus = async (input: DomainProviderInput): Promise<DomainTlsResult> => {
  const [apex, www] = await Promise.all([
    verifyTlsHost(input.domain),
    verifyTlsHost(`www.${input.domain}`),
  ])
  const active = apex.ok && www.ok
  return {
    status: active ? 'active' : 'provisioning',
    diagnostics: [
      diagnostic('tls_certificate', 'TLS certificate', active, {
        expected: 'Valid HTTPS certificate for apex and www',
        observed: { apex: apex.detail, www: www.detail },
      }),
    ],
  }
}

let cachedHealth: { at: number; value: DomainProviderHealth } | null = null

export const GenericDomainProvider: DomainProvider = {
  name: 'generic',

  async getRequiredDns(input): Promise<RequiredDnsRecord[]> {
    requireConfigured()
    return [
      {
        type: 'TXT',
        name: `${config.domains.ownership_prefix}.${input.domain}`,
        host: config.domains.ownership_prefix,
        value: `realestate-saas=${input.ownershipToken}`,
        purpose: 'ownership',
        source: 'opygen_ownership',
      },
      {
        type: 'A',
        name: input.domain,
        host: '@',
        value: config.domains.a_target,
        purpose: 'routing',
        source: 'generic_routing' as const,
        rank: 1,
      },
      {
        type: 'CNAME',
        name: `www.${input.domain}`,
        host: 'www',
        value: normalizeTarget(config.domains.cname_target),
        purpose: 'routing',
        source: 'generic_routing' as const,
        rank: 1,
      },
    ]
  },

  async registerDomain(_input) {
    // Generic provider does not use an external control-plane API.
    // Registration is implicit — the tenant points their DNS records and the
    // domain becomes routable once DNS propagates and TLS is issued by the
    // server (e.g. Caddy, Nginx + Certbot, Traefik).
    return { registered: true, providerRequestId: 'generic-dns-self-managed' }
  },

  async verifyRouting(input): Promise<DomainRoutingResult> {
    requireConfigured()
    const apexTarget = config.domains.a_target
    const cnameTarget = normalizeTarget(config.domains.cname_target)

    const [addresses, cnames] = await Promise.all([
      resolveA(input.domain),
      resolveCname(`www.${input.domain}`),
    ])

    const apexOk = addresses.includes(apexTarget)
    const wwwOk = cnames.some((c) => c === cnameTarget || c.endsWith(`.${cnameTarget}`))

    return {
      apexOk,
      wwwOk,
      // Generic provider: registration is always considered done because there
      // is no external control-plane to register with.
      registered: true,
      providerVerified: apexOk && wwwOk,
      diagnostics: [
        diagnostic('apex_a', 'A / apex routing', apexOk, {
          expected: { target: apexTarget },
          observed: { addresses },
          ...(!apexOk ? { message: `Point the apex A record to ${apexTarget}` } : {}),
        }),
        diagnostic('www_cname', 'www routing', wwwOk, {
          expected: { target: cnameTarget },
          observed: { cnames },
          ...(!wwwOk ? { message: `Point www CNAME to ${cnameTarget}` } : {}),
        }),
        diagnostic('hosting_registration', 'Hosting registration', true, {
          expected: 'Self-managed (no external registration needed)',
          observed: 'ok',
        }),
      ],
    }
  },

  async provisionTls(input): Promise<DomainTlsResult> {
    // For generic provider, TLS is managed by the server itself (Caddy, Certbot, etc.)
    // We just probe the actual TLS status.
    return getTlsStatus(input)
  },

  getTlsStatus,

  async verifyPublicRouting(input): Promise<DomainPublicRoutingResult> {
    const [apex, www] = await Promise.all([
      verifyPublicHost(input.domain),
      verifyPublicHost(`www.${input.domain}`),
    ])
    const active = apex.ok && www.ok
    return {
      active,
      diagnostics: [
        diagnostic('public_routing', 'Public routing', active, {
          expected: `${CHECK_HEADER}: ${CHECK_VALUE}`,
          observed: { apex: apex.observed, www: www.observed },
          ...(!active ? { message: 'Domain is not yet serving the Opygen runtime — DNS propagation or server configuration may still be pending' } : {}),
        }),
      ],
    }
  },

  async removeDomain(_domain: string) {
    // Nothing to clean up in a generic self-managed setup.
  },

  async health(force = false): Promise<DomainProviderHealth> {
    const now = Date.now()
    if (!force && cachedHealth && now - cachedHealth.at < config.domains.provider_health_cache_ms) {
      return cachedHealth.value
    }
    const started = performance.now()
    const configured = providerConfigured()
    const value: DomainProviderHealth = {
      provider: 'generic',
      configured,
      healthy: configured,
      latencyMs: Math.round(performance.now() - started),
      ...(configured
        ? {}
        : { detail: 'DOMAIN_A_TARGET and/or DOMAIN_CNAME_TARGET are not set' }),
      checkedAt: new Date().toISOString(),
    }
    cachedHealth = { at: now, value }
    return value
  },
}
