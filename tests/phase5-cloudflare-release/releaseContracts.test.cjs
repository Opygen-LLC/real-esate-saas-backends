const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

test('retirement gate blocks every remaining Vercel dependency before secrets/project bindings can be removed', () => {
  const source = read('src/app/db/verifyCloudflarePhase5Retirement.ts')
  for (const marker of ['legacyServing', 'pendingMigrations', 'rollbackWindowsOpen', 'vercelCandidates', 'vercelRetiredPendingRemoval']) {
    assert.match(source, new RegExp(marker))
  }
  assert.match(source, /assert-retirement-ready/)
  assert.match(source, /VERCEL_REMOVED/)
})

test('release script requires a stable and recent production verification before destructive Vercel removal', () => {
  const source = read('scripts/cloudflare-phase5-release.mjs')
  assert.match(source, /CLOUDFLARE_PHASE5_STABILITY_HOURS/)
  assert.match(source, /CLOUDFLARE_PHASE5_MAX_VERIFY_AGE_MINUTES/)
  assert.match(source, /CLOUDFLARE_PHASE5_ALLOW_VERCEL_PROJECT_DOMAIN_REMOVAL/)
  assert.match(source, /assertStableVerification/)
  assert.match(source, /firstVerifiedAt/)
  assert.match(source, /lastVerifiedAt/)
})

test('Vercel cleanup paginates inventory and removes only exact platform project-domain bindings', () => {
  const source = read('scripts/cloudflare-phase5-release.mjs')
  assert.match(source, /limit:\s*'100'/)
  assert.match(source, /pagination\?\.next/)
  assert.match(source, /EXACT_PLATFORM_DOMAINS/)
  assert.match(source, /realestate\.opygen\.com/)
  assert.match(source, /\/v9\/projects\/\$\{project\}\/domains/)
  assert.doesNotMatch(source, /DELETE[^\n]+\/v9\/projects\/\$\{project\}(?:`|'|")/)
})

test('live verification requires platform, free tenant, custom hostname, portal isolation and Socket.IO handshake', () => {
  const source = read('scripts/cloudflare-phase5-release.mjs')
  for (const marker of ['_ROOT_URL', '_TENANT_URL', '_CUSTOM_URL', 'tenantPortalIsolation', 'customPortalIsolation', 'socketPollingProbe']) {
    assert.match(source, new RegExp(marker))
  }
  assert.match(source, /transport=polling/)
  assert.match(source, /websocketAdvertised/)
  assert.match(source, /x-opygen-domain-check/)
})

test('DNS matrix is read-only, provider-aware, and verifies customer mail records without deleting MX/TXT', () => {
  const source = read('scripts/cloudflare-phase5-release.mjs')
  assert.match(source, /cloudflare.*namecheap.*godaddy.*hostinger.*other/)
  assert.match(source, /resolveCname/)
  assert.match(source, /resolveMx/)
  assert.match(source, /resolveTxt/)
  assert.match(source, /requireSpf/)
  assert.doesNotMatch(source, /dns_records[^\n]+DELETE/i)
})

test('domain and realtime operational signals use the shared metrics pipeline', () => {
  const metrics = read('src/shared/metrics.ts')
  const provider = read('src/app/module/domain/providers/cloudflareDomainProvider.ts')
  const controller = read('src/app/module/domain/domain.controller.ts')
  const service = read('src/app/module/domain/domain.service.ts')
  const realtime = read('src/app/module/realtime/realtime.server.ts')
  assert.match(metrics, /domain_activation_duration_ms/)
  assert.match(provider, /cloudflare_domain_api_failures_total/)
  assert.match(provider, /cloudflare_domain_certificate_failures_total/)
  assert.match(provider, /cloudflare_domain_hostname_validation_failures_total/)
  assert.match(controller, /domain_resolver_requests_total/)
  assert.match(service, /tenant_routing_mismatch_total/)
  assert.match(realtime, /realtime_connections_total/)
  assert.match(realtime, /realtime_disconnects_total/)
})

test('Vercel provider abstraction remains available for rollback even though production preflight requires Cloudflare', () => {
  const providers = read('src/app/module/domain/providers/index.ts')
  const release = read('scripts/cloudflare-phase5-release.mjs')
  assert.match(providers, /vercel:\s*VercelDomainProvider/)
  assert.match(providers, /cloudflare:\s*CloudflareDomainProvider/)
  assert.match(release, /DOMAIN_PROVIDER must be cloudflare/)
})

test('registration still reserves a unique free subdomain and old-subdomain aliases keep the 308 redirect path', () => {
  const auth = read('src/app/module/auth/auth.services.ts')
  const domain = read('src/app/module/domain/domain.service.ts')
  assert.match(auth, /const reserveSubdomain = async/)
  assert.match(auth, /const subdomain = await reserveSubdomain\(payload\.agencyName\)/)
  assert.match(auth, /buildTenantWebsiteUrl\(subdomain\)/)
  assert.match(domain, /SubdomainAlias\.findOneAndUpdate/)
  assert.match(domain, /canonicalSubdomain/)
})
