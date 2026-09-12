const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ts = require('typescript')
const providerPath = path.join(process.cwd(), 'src/app/module/domain/providers/cloudflareDomainProvider.ts')
const providerSource = fs.readFileSync(providerPath, 'utf8')

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

const ACCOUNT_ID = 'a'.repeat(32)
const ZONE_ID = 'b'.repeat(32)
const API_BASE = 'https://api.cloudflare.test/client/v4'
const CNAME_TARGET = 'customers.opygen.com'
const FALLBACK_ORIGIN = 'saas-fallback.opygen.com'

const config = {
  domains: {
    provider: 'cloudflare',
    ownership_prefix: '_realestate-verification',
    provider_timeout_ms: 8000,
    provider_health_cache_ms: 30000,
    cloudflare_account_id: ACCOUNT_ID,
    cloudflare_zone_id: ZONE_ID,
    cloudflare_api_token: 'cf-test-token-not-a-real-secret-123456',
    cloudflare_api_base: API_BASE,
    cloudflare_saas_fallback_origin: FALLBACK_ORIGIN,
    cloudflare_saas_cname_target: CNAME_TARGET,
    cloudflare_apex_routing_mode: 'optional',
  },
}

const makeHostname = (hostname, index) => ({
  id: String(index).padStart(32, '0'),
  hostname,
  status: 'pending',
  ownership_verification: {
    name: `_cf-custom-hostname.${hostname}`,
    type: 'txt',
    value: `ownership-${index}`,
  },
  ssl: {
    method: 'txt',
    type: 'dv',
    status: 'pending_validation',
    validation_records: [{
      txt_name: `_acme-challenge.${hostname}`,
      txt_value: `dcv-${index}`,
      status: 'pending',
    }],
  },
  verification_errors: [],
})

const state = {
  hostnames: new Map(),
  createBodies: [],
  deletedIds: [],
  publicRouteActive: true,
  apexRouted: true,
  apexPublicActive: true,
}

const jsonResponse = (status, result, success = status >= 200 && status < 300) => new Response(JSON.stringify({
  success,
  result,
  errors: success ? [] : [{ code: 1000, message: 'mock error' }],
  messages: [],
}), { status, headers: { 'content-type': 'application/json' } })

const providerApiFetch = async (_service, rawUrl, init = {}) => {
  const url = new URL(rawUrl)
  const method = String(init.method || 'GET').toUpperCase()

  if (url.origin === 'https://example.com' || url.origin === 'https://www.example.com') {
    const active = state.publicRouteActive && (url.origin !== 'https://example.com' || state.apexPublicActive)
    return new Response('{}', {
      status: active ? 200 : 503,
      headers: active ? { 'x-opygen-domain-check': 'real-estate-saas' } : {},
    })
  }

  const zoneRoot = `/client/v4/zones/${ZONE_ID}`
  if (method === 'GET' && url.pathname === zoneRoot) {
    return jsonResponse(200, { id: ZONE_ID, account: { id: ACCOUNT_ID }, status: 'active' })
  }
  if (method === 'GET' && url.pathname === `${zoneRoot}/custom_hostnames/fallback_origin`) {
    return jsonResponse(200, { origin: FALLBACK_ORIGIN, status: 'active', errors: [] })
  }
  if (url.pathname === `${zoneRoot}/custom_hostnames`) {
    if (method === 'GET') {
      const requested = (url.searchParams.get('hostname') || '').toLowerCase()
      const rows = [...state.hostnames.values()].filter((row) => !requested || row.hostname === requested)
      return jsonResponse(200, rows)
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'))
      state.createBodies.push(body)
      if (state.hostnames.has(body.hostname)) return jsonResponse(409, undefined, false)
      const row = makeHostname(body.hostname, state.hostnames.size + 1)
      state.hostnames.set(body.hostname, row)
      return jsonResponse(201, row)
    }
  }
  const detailMatch = url.pathname.match(new RegExp(`^${zoneRoot}/custom_hostnames/([^/]+)$`))
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1])
    const row = [...state.hostnames.values()].find((item) => item.id === id)
    if (method === 'GET') return row ? jsonResponse(200, row) : jsonResponse(404, undefined, false)
    if (method === 'DELETE') {
      if (!row) return jsonResponse(404, undefined, false)
      state.hostnames.delete(row.hostname)
      state.deletedIds.push(id)
      return jsonResponse(200, { id })
    }
  }
  throw new Error(`Unhandled mock request: ${method} ${rawUrl}`)
}

const dnsMock = {
  resolveCname: async (hostname) => {
    if (hostname === 'example.com') return state.apexRouted ? [CNAME_TARGET] : []
    if (hostname === 'www.example.com') return [CNAME_TARGET]
    return []
  },
  resolve4: async (hostname) => hostname === CNAME_TARGET ? ['203.0.113.10'] : [],
  resolve6: async () => [],
}

const compiled = ts.transpileModule(providerSource, {
  fileName: providerPath,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
}).outputText

const moduleUnderTest = { exports: {} }
const customRequire = (id) => {
  if (id === 'dns/promises') return { __esModule: true, default: dnsMock }
  if (id === '../../../../errors/ApiError') return { __esModule: true, default: ApiError }
  if (id === '../../../../config') return { __esModule: true, default: config }
  if (id === '../../../../shared/resilience') return { Resilience: { fetch: providerApiFetch } }
  throw new Error(`Unexpected require from provider: ${id}`)
}
new Function('require', 'module', 'exports', compiled)(customRequire, moduleUnderTest, moduleUnderTest.exports)
const { CloudflareDomainProvider } = moduleUnderTest.exports

const input = { domain: 'example.com', organizationId: 'org_cloudflare_phase2', ownershipToken: 'opygen-owner-token' }

test.beforeEach(() => {
  state.hostnames.clear()
  state.createBodies.length = 0
  state.deletedIds.length = 0
  state.publicRouteActive = true
  state.apexRouted = true
  state.apexPublicActive = true
})

test('registers apex and www as Cloudflare for SaaS Custom Hostnames with TXT DCV and metadata', async () => {
  const result = await CloudflareDomainProvider.registerDomain(input)
  assert.equal(result.registered, true)
  assert.equal(state.hostnames.size, 2)
  assert.equal(result.providerMetadata.hostnames.length, 2)
  assert.ok(result.providerRequestId)
  assert.deepEqual(state.createBodies.map((body) => body.hostname).sort(), ['example.com', 'www.example.com'])
  for (const body of state.createBodies) {
    assert.equal(body.ssl.method, 'txt')
    assert.equal(body.ssl.type, 'dv')
    assert.equal(body.ssl.settings.min_tls_version, '1.2')
    assert.equal(body.custom_metadata.organization_id, input.organizationId)
  }
})

test('returns Opygen ownership, Cloudflare routing, hostname validation, and SSL validation records', async () => {
  await CloudflareDomainProvider.registerDomain(input)
  const records = await CloudflareDomainProvider.getRequiredDns(input)
  assert.ok(records.some((row) => row.source === 'opygen_ownership' && row.type === 'TXT'))
  assert.equal(records.filter((row) => row.source === 'cloudflare_routing').length, 2)
  assert.equal(records.filter((row) => row.source === 'cloudflare_hostname_validation').length, 2)
  assert.equal(records.filter((row) => row.source === 'cloudflare_ssl_validation').length, 2)
  assert.ok(records.filter((row) => row.source === 'cloudflare_routing').every((row) => row.value === CNAME_TARGET))
})

test('reports routing/hostname state, then TLS provisioning and active state from Cloudflare statuses', async () => {
  await CloudflareDomainProvider.registerDomain(input)
  for (const row of state.hostnames.values()) row.status = 'active'
  const routing = await CloudflareDomainProvider.verifyRouting(input)
  assert.equal(routing.apexOk, true)
  assert.equal(routing.wwwOk, true)
  assert.equal(routing.registered, true)
  assert.equal(routing.providerVerified, true)

  const provisioning = await CloudflareDomainProvider.getTlsStatus(input)
  assert.equal(provisioning.status, 'provisioning')
  for (const row of state.hostnames.values()) row.ssl.status = 'active'
  const tls = await CloudflareDomainProvider.provisionTls(input)
  assert.equal(tls.status, 'active')
  assert.ok(tls.providerMetadata.hostnames.every((row) => row.sslStatus === 'active'))
})

test('verifies the existing Opygen public-routing marker, health, idempotent registration, and cleanup', async () => {
  const first = await CloudflareDomainProvider.registerDomain(input)
  const second = await CloudflareDomainProvider.registerDomain(input)
  assert.equal(first.providerMetadata.hostnames.length, 2)
  assert.equal(second.providerMetadata.hostnames.length, 2)
  assert.equal(state.createBodies.length, 2, 'second registration must reuse existing hostnames')

  for (const row of state.hostnames.values()) {
    row.status = 'active'
    row.ssl.status = 'active'
  }
  const publicRouting = await CloudflareDomainProvider.verifyPublicRouting(input)
  assert.equal(publicRouting.active, true)
  const health = await CloudflareDomainProvider.health(true)
  assert.equal(health.configured, true)
  assert.equal(health.healthy, true)

  assert.equal(await CloudflareDomainProvider.hasDomain(input.domain), true)
  await CloudflareDomainProvider.removeDomain(input.domain)
  assert.equal(state.hostnames.size, 0)
  assert.equal(state.deletedIds.length, 2)
})

test('cost-effective mode activates www when apex routing is unavailable and makes www canonical', async () => {
  await CloudflareDomainProvider.registerDomain(input)
  const apex = state.hostnames.get('example.com')
  const www = state.hostnames.get('www.example.com')
  apex.status = 'pending'
  apex.ssl.status = 'pending_validation'
  www.status = 'active'
  www.ssl.status = 'active'
  state.apexRouted = false
  state.apexPublicActive = false

  const records = await CloudflareDomainProvider.getRequiredDns(input)
  const apexRouting = records.find((row) => row.source === 'cloudflare_routing' && row.host === '@')
  const wwwRouting = records.find((row) => row.source === 'cloudflare_routing' && row.host === 'www')
  assert.equal(apexRouting.required, false)
  assert.equal(wwwRouting.required, true)

  const routing = await CloudflareDomainProvider.verifyRouting(input)
  assert.equal(routing.apexOk, false)
  assert.equal(routing.wwwOk, true)
  assert.equal(routing.routingReady, true)
  assert.equal(routing.providerVerified, true)
  assert.equal(routing.canonicalHost, 'www.example.com')

  const tls = await CloudflareDomainProvider.getTlsStatus(input)
  assert.equal(tls.status, 'active')
  assert.equal(tls.canonicalHost, 'www.example.com')

  const publicRouting = await CloudflareDomainProvider.verifyPublicRouting(input)
  assert.equal(publicRouting.active, true)
  assert.equal(publicRouting.canonicalHost, 'www.example.com')
})

