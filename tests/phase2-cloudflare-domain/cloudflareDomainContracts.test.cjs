const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

test('registers cloudflare without removing vercel rollback and preserves the provider interface', () => {
  const index = read('src/app/module/domain/providers/index.ts')
  const contract = read('src/app/module/domain/providers/domainProvider.ts')
  assert.match(index, /cloudflare:\s*CloudflareDomainProvider/)
  assert.match(index, /vercel:\s*VercelDomainProvider/)
  for (const method of ['getRequiredDns', 'registerDomain', 'verifyRouting', 'provisionTls', 'getTlsStatus', 'verifyPublicRouting', 'removeDomain', 'hasDomain', 'health']) {
    assert.match(contract, new RegExp(method))
  }
  assert.match(contract, /providerMetadata\?: DomainProviderMetadata/)
  assert.match(contract, /cloudflare_hostname_validation/)
  assert.match(contract, /cloudflare_ssl_validation/)
})

test('persists multi-hostname provider metadata but keeps it internal to the public domain response', () => {
  const model = read('src/app/module/domain/domain.model.ts')
  const service = read('src/app/module/domain/domain.service.ts')
  assert.match(model, /providerHostnameMetadataSchema/)
  assert.match(model, /providerMetadata: \{ type: providerMetadataSchema/)
  assert.match(service, /providerMetadata: providerRegistration\.providerMetadata/)
  assert.match(service, /if \(routing\.providerMetadata\) providerMetadata = routing\.providerMetadata/)
  assert.match(service, /if \(tls\.providerMetadata\) providerMetadata = tls\.providerMetadata/)
  assert.match(service, /providerMetadata: _providerMetadata/)
  assert.match(service, /providerRequestId/)
})

test('fails closed for Cloudflare production configuration and never exports the API token to the frontend namespace', () => {
  const config = read('src/config/index.ts')
  const env = read('.env.example')
  assert.match(config, /DOMAIN_PROVIDER must be one of: vercel, generic, cloudflare/)
  for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_SAAS_FALLBACK_ORIGIN', 'CLOUDFLARE_SAAS_CNAME_TARGET']) {
    assert.match(config, new RegExp(`requiredInProduction\\('${name}'`))
    assert.match(env, new RegExp(`^${name}=`, 'm'))
  }
  assert.doesNotMatch(env, /NEXT_PUBLIC_CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID|ZONE_ID)/)
})
