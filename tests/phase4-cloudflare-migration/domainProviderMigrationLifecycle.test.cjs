const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const servicePath = path.join(process.cwd(), 'src/app/module/domain/domain.service.ts')
const source = fs.readFileSync(servicePath, 'utf8')

class ApiError extends Error {
  constructor(statusCode, message) { super(message); this.statusCode = statusCode }
}

const state = {
  providerValidated: false,
  routeReady: false,
  tlsActive: false,
  publicActive: false,
  cloudflareRemovals: 0,
  vercelRemovals: 0,
}

const config = {
  domains: {
    provider: 'cloudflare',
    provider_migration_target: 'cloudflare',
    provider_migration_rollback_grace_ms: 7 * 24 * 60 * 60_000,
    replacement_grace_ms: 7 * 24 * 60 * 60_000,
    ownership_prefix: '_realestate-verification',
  },
}

const requiredDns = [
  { type: 'TXT', host: '_realestate-verification', name: '_realestate-verification.example.com', value: 'realestate-saas=owner-token', purpose: 'ownership', source: 'opygen_ownership', required: true },
  { type: 'TXT', host: '_cf-custom-hostname', name: '_cf-custom-hostname.example.com', value: 'cf-owner', purpose: 'provider_verification', source: 'cloudflare_hostname_validation', required: true },
  { type: 'CNAME', host: 'www', name: 'www.example.com', value: 'customers.opygen.com', purpose: 'routing', source: 'cloudflare_routing', required: true },
]

const diag = (check, ok) => ({ check, label: check, state: ok ? 'pass' : 'pending', ok, checkedAt: new Date() })
const cloudflareProvider = {
  name: 'cloudflare',
  async registerDomain() { return { registered: true, providerRequestId: 'cf-apex-id', providerMetadata: { hostnames: [{ hostname: 'example.com', providerId: 'cf-apex-id' }, { hostname: 'www.example.com', providerId: 'cf-www-id' }] } } },
  async getRequiredDns() { return requiredDns },
  async verifyRouting() {
    return {
      apexOk: state.routeReady,
      wwwOk: state.routeReady,
      routingReady: state.routeReady,
      canonicalHost: 'www.example.com',
      registered: true,
      providerVerified: state.providerValidated,
      diagnostics: [diag('hosting_registration', state.providerValidated), diag('www_cname', state.routeReady)],
      providerMetadata: { hostnames: [{ hostname: 'example.com', providerId: 'cf-apex-id', status: state.providerValidated ? 'active' : 'pending' }, { hostname: 'www.example.com', providerId: 'cf-www-id', status: state.providerValidated ? 'active' : 'pending' }] },
    }
  },
  async getTlsStatus() { return { status: state.tlsActive ? 'active' : 'provisioning', canonicalHost: 'www.example.com', diagnostics: [diag('tls_certificate', state.tlsActive)], providerMetadata: { hostnames: [] } } },
  async provisionTls() { return this.getTlsStatus() },
  async verifyPublicRouting() { return { active: state.publicActive, canonicalHost: 'www.example.com', diagnostics: [diag('public_routing', state.publicActive)] } },
  async removeDomain() { state.cloudflareRemovals += 1 },
  async hasDomain() { return true },
  async health() { return { provider: 'cloudflare', configured: true, healthy: true, latencyMs: 1, checkedAt: new Date().toISOString() } },
}
const vercelProvider = {
  name: 'vercel',
  async registerDomain() { return { registered: true } },
  async getRequiredDns() { return [{ type: 'A', host: '@', name: 'example.com', value: '76.76.21.21', purpose: 'routing', source: 'vercel_recommended' }] },
  async verifyRouting() { return { apexOk: true, wwwOk: true, routingReady: true, canonicalHost: 'example.com', registered: true, providerVerified: true, diagnostics: [diag('hosting_registration', true)] } },
  async getTlsStatus() { return { status: 'active', canonicalHost: 'example.com', diagnostics: [diag('tls_certificate', true)] } },
  async provisionTls() { return this.getTlsStatus() },
  async verifyPublicRouting() { return { active: true, canonicalHost: 'example.com', diagnostics: [diag('public_routing', true)] } },
  async removeDomain() { state.vercelRemovals += 1 },
  async hasDomain() { return true },
  async health() { return { provider: 'vercel', configured: true, healthy: true, latencyMs: 1, checkedAt: new Date().toISOString() } },
}
const providerService = {
  byName(name) { if (name === 'cloudflare') return cloudflareProvider; if (name === 'vercel') return vercelProvider; throw new Error(`unknown ${name}`) },
  current() { return cloudflareProvider },
  health() { return cloudflareProvider.health() },
}

let currentRecord
const makeRecord = () => ({
  organizationId: 'org-1',
  domain: 'example.com',
  canonicalHost: 'example.com',
  ownershipToken: 'owner-token',
  entitlementStatus: 'active',
  lifecycleStatus: 'ACTIVE',
  provider: 'vercel',
  providerRegistrationStatus: 'registered',
  publicRoutingStatus: 'active',
  status: 'verified',
  tlsStatus: 'active',
  providerRequestId: 'vercel-id',
  providerMetadata: { hostnames: [] },
  requiredDns: [{ type: 'A', host: '@', name: 'example.com', value: '76.76.21.21', purpose: 'routing', source: 'vercel_recommended' }],
  diagnostics: [],
  failureReason: '',
  failureCount: 0,
  lastCheckedAt: new Date(),
  nextCheckAt: new Date(),
  ownershipVerifiedAt: new Date(),
  routingVerifiedAt: new Date(),
  providerRegisteredAt: new Date(),
  tlsActiveAt: new Date(),
  activeAt: new Date(),
  verifiedAt: new Date(),
  candidate: null,
  providerMigration: null,
  retiredDomains: [],
  async save() { return this },
})

const DomainRecord = {
  async findOne(query) { return query.organizationId === 'org-1' ? currentRecord : null },
}
const Organization = {
  async updateOne() { return { modifiedCount: 1 } },
  findOne() { throw new Error('Organization.findOne not expected in this migration test') },
}

const compiled = ts.transpileModule(source, {
  fileName: servicePath,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText
const moduleUnderTest = { exports: {} }
const customRequire = (id) => {
  if (id === 'dns/promises') return { __esModule: true, default: { resolveTxt: async () => [['realestate-saas=owner-token']] } }
  if (id === 'crypto') return { randomBytes: () => ({ toString: () => 'random-token' }) }
  if (id === 'url') return { domainToASCII: (value) => value }
  if (id === 'http-status') return { __esModule: true, default: { BAD_REQUEST: 400, NOT_FOUND: 404, CONFLICT: 409 } }
  if (id === '../../../errors/ApiError') return { __esModule: true, default: ApiError }
  if (id === '../../../config') return { __esModule: true, default: config }
  if (id === '../../../shared/metrics') return { Metrics: { inc() {}, observeDomainActivation() {} } }
  if (id === '../organization/organization.model') return { Organization }
  if (id === './domain.model') return { DomainRecord, DOMAIN_LIFECYCLE_STATUSES: ['PENDING_DNS', 'OWNERSHIP_VERIFIED', 'ROUTING_VERIFIED', 'TLS_PROVISIONING', 'ACTIVE'] }
  if (id === '../entitlement/entitlement.service') return { EntitlementService: { assertFeature: async () => {} } }
  if (id === '../domainEvent/cacheInvalidation.service') return { CacheInvalidationService: { invalidateTenant: async () => {} } }
  if (id === '../../helpers/identity') return { normalizeSubdomain: (v) => v, RESERVED_SUBDOMAINS: new Set() }
  if (id === '../../helpers/publicWebsiteUrl') return { buildTenantWebsiteUrl: (v) => `https://${v}.realestate.opygen.com` }
  if (id === './subdomainAlias.model') return { SubdomainAlias: {} }
  if (id === './providers') return { DomainProviderService: providerService }
  if (id === '../compliance/tenantPurgeBarrier.service') return { TenantPurgeBarrier: { assertTenantWritable: async () => {} } }
  if (id === '../tenantAccess/tenantAccess.service') return { TenantAccessService: {} }
  if (id === '../tenantAccess/tenantAccessMonitoring.service') return { TenantAccessMonitoringService: {} }
  throw new Error(`Unexpected require: ${id}`)
}
new Function('require', 'module', 'exports', compiled)(customRequire, moduleUnderTest, moduleUnderTest.exports)
const { DomainService } = moduleUnderTest.exports

test.beforeEach(() => {
  currentRecord = makeRecord()
  state.providerValidated = false
  state.routeReady = false
  state.tlsActive = false
  state.publicActive = false
  state.cloudflareRemovals = 0
  state.vercelRemovals = 0
})

test('actual migration lifecycle keeps Vercel active until Cloudflare DNS and runtime both pass', async () => {
  let result = await DomainService.startProviderMigrationByOrganization('org-1')
  assert.equal(result.providerMigration.migrationStatus, 'CF_REGISTERED')
  assert.equal(currentRecord.provider, 'vercel')
  assert.equal(currentRecord.lifecycleStatus, 'ACTIVE')

  result = await DomainService.advanceProviderMigrationByOrganization('org-1')
  assert.equal(result.providerMigration.migrationStatus, 'WAITING_DNS')
  assert.equal(currentRecord.provider, 'vercel')
  assert.equal(currentRecord.lifecycleStatus, 'ACTIVE')

  state.providerValidated = true
  state.tlsActive = true
  result = await DomainService.advanceProviderMigrationByOrganization('org-1')
  assert.equal(result.providerMigration.migrationStatus, 'CF_TLS_ACTIVE')
  assert.equal(currentRecord.provider, 'vercel')

  // Even though both providers serve the same marker, the provider must not
  // switch until DNS routing itself points at Cloudflare.
  state.publicActive = true
  result = await DomainService.advanceProviderMigrationByOrganization('org-1')
  assert.equal(result.providerMigration.migrationStatus, 'CF_TLS_ACTIVE')
  assert.equal(currentRecord.provider, 'vercel')

  state.routeReady = true
  result = await DomainService.advanceProviderMigrationByOrganization('org-1')
  assert.equal(result.providerMigration.migrationStatus, 'TRAFFIC_SWITCHED')
  assert.equal(currentRecord.provider, 'cloudflare')
  assert.equal(currentRecord.lifecycleStatus, 'ACTIVE')
  assert.equal(currentRecord.publicRoutingStatus, 'active')
  assert.ok(currentRecord.providerMigration.rollbackUntil)
  assert.equal(state.vercelRemovals, 0)
})

test('rollback restores the Vercel snapshot before deleting the Cloudflare target', async () => {
  await DomainService.startProviderMigrationByOrganization('org-1')
  state.providerValidated = true
  state.tlsActive = true
  state.routeReady = true
  state.publicActive = true
  await DomainService.advanceProviderMigrationByOrganization('org-1')
  assert.equal(currentRecord.provider, 'cloudflare')

  const result = await DomainService.rollbackProviderMigrationByOrganization('org-1')
  assert.equal(currentRecord.provider, 'vercel')
  assert.equal(currentRecord.lifecycleStatus, 'ACTIVE')
  assert.equal(result.providerMigration, null)
  assert.equal(state.cloudflareRemovals, 1)
  assert.equal(state.vercelRemovals, 0)
})

test('finalization cannot remove Vercel before grace expiry and removes it after the window', async () => {
  await DomainService.startProviderMigrationByOrganization('org-1')
  state.providerValidated = true
  state.tlsActive = true
  state.routeReady = true
  state.publicActive = true
  await DomainService.advanceProviderMigrationByOrganization('org-1')

  await assert.rejects(() => DomainService.finalizeProviderMigrationByOrganization('org-1'), /Rollback grace period is still active/)
  assert.equal(state.vercelRemovals, 0)
  currentRecord.providerMigration.rollbackUntil = new Date(Date.now() - 1000)
  const result = await DomainService.finalizeProviderMigrationByOrganization('org-1')
  assert.equal(result.providerMigration.migrationStatus, 'VERCEL_REMOVED')
  assert.equal(state.vercelRemovals, 1)
  assert.equal(currentRecord.provider, 'cloudflare')
})
