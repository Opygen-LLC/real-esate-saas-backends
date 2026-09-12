const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const test = require('node:test')

process.env.CLOUDFLARE_ACCOUNT_ID = 'a'.repeat(32)
process.env.CLOUDFLARE_ZONE_ID = 'b'.repeat(32)
process.env.CLOUDFLARE_API_TOKEN = 'not-a-real-cloudflare-token-for-tests'
process.env.CLOUDFLARE_PLATFORM_ROOT_DOMAIN = 'realestate.opygen.com'
process.env.CLOUDFLARE_WORKER_SCRIPT_NAME = 'opygen-real-estate-frontend'

let mod

test.before(async () => {
  mod = await import(`${pathToFileURL(path.join(process.cwd(), 'scripts/cloudflare-phase4-platform.mjs')).href}?test=${Date.now()}`)
})

test('rollback snapshot captures only platform web-routing records and platform worker routes', () => {
  const selected = mod.selectRollbackState([
    { type: 'A', name: 'realestate.opygen.com', content: '76.76.21.21', proxied: false, ttl: 300 },
    { type: 'TXT', name: 'realestate.opygen.com', content: 'keep-me', proxied: false, ttl: 300 },
    { type: 'CNAME', name: '*.realestate.opygen.com', content: 'cname.vercel-dns.com', proxied: false, ttl: 300 },
    { type: 'A', name: 'api.opygen.com', content: '192.0.2.1', proxied: false, ttl: 300 },
  ], [
    { pattern: 'realestate.opygen.com/*', script: null },
    { pattern: '*.realestate.opygen.com/*', script: null },
    { pattern: 'api.opygen.com/*', script: null },
  ])
  assert.deepEqual(selected.dns.map((row) => row.type).sort(), ['A', 'CNAME'])
  assert.ok(selected.dns.every((row) => row.name.includes('realestate.opygen.com')))
  assert.deepEqual(selected.routes.map((row) => row.pattern).sort(), ['*.realestate.opygen.com/*', 'realestate.opygen.com/*'])
})

test('phase3 cutover preserves TXT/MX/CAA records sharing the platform hostname', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/cloudflare-phase3.mjs'), 'utf8')
  assert.match(source, /WEB_ROUTING_TYPES = new Set\(\['A', 'AAAA', 'CNAME'\]\)/)
  assert.match(source, /const conflicts = sameName\.filter\(\(record\) => WEB_ROUTING_TYPES\.has/)
  assert.match(source, /for \(const record of conflicts\) await deleteDns\(record\.id\)/)
  assert.doesNotMatch(source, /for \(const record of sameName\) await deleteDns\(record\.id\)/)
})

test('platform cutover is staging-gated and can automatically restore the pre-cutover snapshot', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/cloudflare-phase4-platform.mjs'), 'utf8')
  assert.match(source, /CLOUDFLARE_PHASE4_STAGING_ROOT_URL/)
  assert.match(source, /CLOUDFLARE_PHASE4_STAGING_TENANT_URL/)
  assert.match(source, /await stagingGate\(\)/)
  assert.match(source, /if \(AUTO_ROLLBACK\)/)
  assert.match(source, /await restoreSnapshot\(snapshot\)/)
})

test('platform cutover refuses to use a stale rollback snapshot', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/cloudflare-phase4-platform.mjs'), 'utf8')
  assert.match(source, /captureRollbackState\(\{ overwrite: true \}\)/)
  assert.match(source, /await assertRollbackSnapshotCurrent\(snapshot\)/)
  assert.match(source, /changed after the Phase 4 plan was captured/)
})
