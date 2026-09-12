const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

test('persists an explicit Vercel to Cloudflare migration state without replacing the serving provider immediately', () => {
  const model = read('src/app/module/domain/domain.model.ts')
  const service = read('src/app/module/domain/domain.service.ts')
  for (const status of ['NOT_STARTED', 'CF_REGISTERED', 'WAITING_DNS', 'CF_TLS_ACTIVE', 'TRAFFIC_SWITCHED', 'VERCEL_REMOVED']) {
    assert.match(model, new RegExp(`'${status}'`))
  }
  assert.match(model, /providerMigration: \{ type: providerMigrationSchema, default: null \}/)
  assert.match(model, /legacy: \{ type: candidateDomainSchema, default: null \}/)
  assert.match(model, /target: \{ type: candidateDomainSchema, default: null \}/)
  assert.match(service, /legacy: snapshotLifecycleState\(record\)/)
  assert.match(service, /migrationStatus: 'CF_REGISTERED'/)
  assert.match(service, /applyLifecycleResult\(record, target\)/)
  assert.match(service, /migration\.migrationStatus = 'TRAFFIC_SWITCHED'/)
})

test('normal lifecycle is pinned to the record provider instead of silently following DOMAIN_PROVIDER', () => {
  const service = read('src/app/module/domain/domain.service.ts')
  const providers = read('src/app/module/domain/providers/index.ts')
  assert.match(providers, /byName\(name: string\): DomainProvider/)
  assert.match(service, /DomainProviderService\.byName\(providerName \|\| slot\.provider \|\| config\.domains\.provider\)/)
  assert.match(service, /evaluateLifecycle\(record, record\.organizationId, record\.provider \|\| config\.domains\.provider\)/)
  assert.match(service, /evaluateLifecycle\(record\.candidate, record\.organizationId, record\.candidate\.provider \|\| config\.domains\.provider\)/)
})

test('migration pre-validates TLS before traffic switch and requires Cloudflare DNS plus runtime proof', () => {
  const service = read('src/app/module/domain/domain.service.ts')
  assert.match(service, /provider\.getTlsStatus\(input\)/)
  assert.match(service, /migration\.migrationStatus = 'CF_TLS_ACTIVE'/)
  assert.match(service, /const routeReady = Boolean\(routing\.routingReady \?\? \(routing\.apexOk && routing\.wwwOk\)\)/)
  assert.match(service, /if \(routeReady\) \{/)
  assert.match(service, /provider\.verifyPublicRouting\(input\)/)
  assert.match(service, /Do not use the public marker alone/)
})

test('legacy Vercel registration is retained through rollback grace and removed only by explicit finalization', () => {
  const service = read('src/app/module/domain/domain.service.ts')
  const cli = read('src/app/db/migrateVercelDomainsToCloudflare.ts')
  assert.match(service, /provider_migration_rollback_grace_ms/)
  assert.match(service, /legacyProvider\.removeDomain\(record\.domain\)/)
  assert.match(service, /migration\.migrationStatus = 'VERCEL_REMOVED'/)
  assert.match(cli, /CLOUDFLARE_PHASE4_ALLOW_VERCEL_REMOVAL/)
  assert.match(cli, /rollback grace (?:period|window)/i)
})

test('rollback verifies Vercel is actually serving before restoring the provider snapshot', () => {
  const service = read('src/app/module/domain/domain.service.ts')
  assert.match(service, /legacyProvider\.hasDomain\(legacy\.domain\)/)
  assert.match(service, /legacyProvider\.verifyRouting\(input\)/)
  assert.match(service, /legacyProvider\.getTlsStatus\(input\)/)
  assert.match(service, /legacyProvider\.verifyPublicRouting\(input\)/)
  assert.match(service, /Rollback DNS is not serving from Vercel yet/)
  assert.match(service, /applyLifecycleResult\(record, legacy\)/)
})

test('retired-domain cleanup remembers the provider that owns each registration', () => {
  const model = read('src/app/module/domain/domain.model.ts')
  const service = read('src/app/module/domain/domain.service.ts')
  assert.match(model, /provider: \{ type: String, default: '' \}/)
  assert.match(service, /DomainProviderService\.byName\(raw\.provider \|\| record\.provider \|\| config\.domains\.provider\)/)
  assert.match(service, /provider: providerName \|\| record\.provider \|\| config\.domains\.provider/)
})

test('Cloudflare and Vercel providers can be configured simultaneously during migration', () => {
  const cloudflare = read('src/app/module/domain/providers/cloudflareDomainProvider.ts')
  const vercel = read('src/app/module/domain/providers/vercelDomainProvider.ts')
  assert.doesNotMatch(cloudflare, /config\.domains\.provider === 'cloudflare'\s*&&/)
  assert.doesNotMatch(vercel, /config\.domains\.provider === 'vercel'\s*&&/)
})
