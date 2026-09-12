const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const test = require('node:test')

process.env.CLOUDFLARE_ACCOUNT_ID = 'a'.repeat(32)
process.env.CLOUDFLARE_ZONE_ID = 'b'.repeat(32)
process.env.CLOUDFLARE_API_TOKEN = 'not-a-real-cloudflare-token-for-tests'
process.env.CLOUDFLARE_ZONE_NAME = 'opygen.com'
process.env.CLOUDFLARE_WORKER_SCRIPT_NAME = 'opygen-real-estate-frontend'
process.env.CLOUDFLARE_PLATFORM_ROOT_DOMAIN = 'realestate.opygen.com'
process.env.CLOUDFLARE_SAAS_FALLBACK_ORIGIN = 'saas-fallback.opygen.com'
process.env.CLOUDFLARE_SAAS_CNAME_TARGET = 'customers.opygen.com'

let mod

test.before(async () => {
  const url = pathToFileURL(path.join(process.cwd(), 'scripts/cloudflare-phase3.mjs')).href
  mod = await import(`${url}?test=${Date.now()}`)
})

test('defines only the four intended managed DNS records and keeps them proxied', () => {
  const specs = mod.managedDnsSpecs()
  assert.deepEqual(specs.map((row) => row.role).sort(), ['fallback-origin', 'platform-root', 'platform-wildcard', 'saas-cname-target'])
  assert.ok(specs.every((row) => row.proxied === true))
  assert.ok(specs.some((row) => row.name === 'realestate.opygen.com' && row.type === 'AAAA' && row.content === '100::'))
  assert.ok(specs.some((row) => row.name === '*.realestate.opygen.com' && row.type === 'AAAA' && row.content === '100::'))
  assert.ok(specs.some((row) => row.name === 'customers.opygen.com' && row.type === 'CNAME' && row.content === 'saas-fallback.opygen.com'))
})

test('bootstrap installs no-worker exclusions before platform cutover while SaaS traffic uses broad Worker route', () => {
  const inventory = [
    { name: 'opygen.com' },
    { name: 'api.opygen.com' },
    { name: 'media.opygen.com' },
    { name: 'realestate.opygen.com' },
    { name: '*.realestate.opygen.com' },
    { name: 'saas-fallback.opygen.com' },
    { name: 'customers.opygen.com' },
  ]
  const routes = mod.buildRoutePlan(inventory, 'bootstrap')
  const byPattern = new Map(routes.map((row) => [row.pattern, row.script]))
  assert.equal(byPattern.get('*/*'), 'opygen-real-estate-frontend')
  assert.equal(byPattern.get('api.opygen.com/*'), null)
  assert.equal(byPattern.get('media.opygen.com/*'), null)
  assert.equal(byPattern.get('realestate.opygen.com/*'), null)
  assert.equal(byPattern.get('*.realestate.opygen.com/*'), null)
  assert.equal(byPattern.has('saas-fallback.opygen.com/*'), false)
  assert.equal(byPattern.has('customers.opygen.com/*'), false)
})

test('cutover sends only the platform namespace to the frontend Worker and leaves unrelated hosts excluded', () => {
  const inventory = [
    { name: 'opygen.com' },
    { name: 'api.opygen.com' },
    { name: 'mail.opygen.com' },
    { name: 'realestate.opygen.com' },
    { name: '*.realestate.opygen.com' },
    { name: 'special.realestate.opygen.com' },
  ]
  const routes = mod.buildRoutePlan(inventory, 'cutover')
  const byPattern = new Map(routes.map((row) => [row.pattern, row.script]))
  assert.equal(byPattern.get('*/*'), 'opygen-real-estate-frontend')
  assert.equal(byPattern.get('opygen.com/*'), null)
  assert.equal(byPattern.get('api.opygen.com/*'), null)
  assert.equal(byPattern.get('mail.opygen.com/*'), null)
  assert.equal(byPattern.get('realestate.opygen.com/*'), 'opygen-real-estate-frontend')
  assert.equal(byPattern.get('*.realestate.opygen.com/*'), 'opygen-real-estate-frontend')
  assert.equal(byPattern.get('special.realestate.opygen.com/*'), 'opygen-real-estate-frontend')
})

test('advanced certificate must include zone apex, platform root, and the deeper wildcard', () => {
  assert.equal(mod.certificateCovers({ hosts: ['opygen.com', 'realestate.opygen.com', '*.realestate.opygen.com'] }), true)
  assert.equal(mod.certificateCovers({ hosts: ['opygen.com', '*.opygen.com'] }), false)
  assert.equal(mod.certificateCovers({ hosts: ['realestate.opygen.com', '*.realestate.opygen.com'] }), false)
})

test('authoritative nameserver comparison is order-insensitive and exact', () => {
  assert.equal(mod.nameserversMatch(['bob.ns.cloudflare.com', 'ada.ns.cloudflare.com'], ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']), true)
  assert.equal(mod.nameserversMatch(['ada.ns.cloudflare.com'], ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']), false)
})

test('domain lifecycle persists the provider-selected canonical host without changing endpoint contracts', () => {
  const fs = require('node:fs')
  const model = fs.readFileSync(path.join(process.cwd(), 'src/app/module/domain/domain.model.ts'), 'utf8')
  const service = fs.readFileSync(path.join(process.cwd(), 'src/app/module/domain/domain.service.ts'), 'utf8')
  const contract = fs.readFileSync(path.join(process.cwd(), 'src/app/module/domain/providers/domainProvider.ts'), 'utf8')
  assert.match(model, /canonicalHost: \{ type: String, default: '' \}/)
  assert.match(service, /'requiredDns', 'canonicalHost'/)
  assert.match(service, /routing\.routingReady \?\? \(routing\.apexOk && routing\.wwwOk\)/)
  assert.match(service, /record\.canonicalHost \|\| record\.domain/)
  assert.match(contract, /routingReady\?: boolean/)
  assert.match(contract, /canonicalHost\?: string/)
})
