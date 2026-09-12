#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const envFile = process.env.CLOUDFLARE_PHASE4_ENV_FILE || '.env'
try { process.loadEnvFile(envFile) } catch (error) {
  if (process.env.CLOUDFLARE_PHASE4_ENV_FILE) throw new Error(`Could not load ${envFile}: ${error instanceof Error ? error.message : String(error)}`)
}

const API_BASE = (process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/$/, '')
const ZONE_ID = (process.env.CLOUDFLARE_ZONE_ID || '').trim()
const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim()
const TOKEN = (process.env.CLOUDFLARE_API_TOKEN || '').trim()
const PLATFORM_ROOT = normalizeHost(process.env.CLOUDFLARE_PLATFORM_ROOT_DOMAIN || 'realestate.opygen.com')
const WORKER = (process.env.CLOUDFLARE_WORKER_SCRIPT_NAME || 'opygen-real-estate-frontend').trim()
const STATE_FILE = resolvePath(process.env.CLOUDFLARE_PHASE4_PLATFORM_STATE_FILE || '.cloudflare/phase4-platform-rollback.json')
const ALLOW_CUTOVER = boolEnv('CLOUDFLARE_PHASE4_ALLOW_PLATFORM_CUTOVER', false)
const ALLOW_ROLLBACK = boolEnv('CLOUDFLARE_PHASE4_ALLOW_PLATFORM_ROLLBACK', false)
const REQUIRE_STAGING_GATE = boolEnv('CLOUDFLARE_PHASE4_REQUIRE_STAGING_GATE', true)
const AUTO_ROLLBACK = boolEnv('CLOUDFLARE_PHASE4_AUTO_ROLLBACK_ON_GATE_FAILURE', true)
const STAGING_ROOT_URL = (process.env.CLOUDFLARE_PHASE4_STAGING_ROOT_URL || '').trim()
const STAGING_TENANT_URL = (process.env.CLOUDFLARE_PHASE4_STAGING_TENANT_URL || '').trim()
const STAGING_CUSTOM_URL = (process.env.CLOUDFLARE_PHASE4_STAGING_CUSTOM_URL || '').trim()
const PRODUCTION_TEST_SUBDOMAIN = normalizeHost(process.env.CLOUDFLARE_PHASE3_TEST_SUBDOMAIN || '')
const MARKER_PATH = '/.well-known/opygen-domain-check'
const MARKER_HEADER = 'x-opygen-domain-check'
const MARKER_VALUE = 'real-estate-saas'
const WEB_TYPES = new Set(['A', 'AAAA', 'CNAME'])

function normalizeHost(value) { return String(value || '').trim().replace(/\.$/, '').toLowerCase() }
function boolEnv(name, fallback) { const raw = process.env[name]; return raw == null || raw === '' ? fallback : /^(1|true|yes|on)$/i.test(raw) }
function isPlatformHost(name) { const host = normalizeHost(name); return host === PLATFORM_ROOT || host === `*.${PLATFORM_ROOT}` || host.endsWith(`.${PLATFORM_ROOT}`) }
function platformRoute(route) {
  const pattern = String(route?.pattern || '')
  const host = normalizeHost(pattern.split('/')[0])
  return host === PLATFORM_ROOT || host === `*.${PLATFORM_ROOT}` || host.endsWith(`.${PLATFORM_ROOT}`)
}
function assertConfig() {
  const missing = []
  if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) missing.push('CLOUDFLARE_ACCOUNT_ID')
  if (!/^[a-f0-9]{32}$/i.test(ZONE_ID)) missing.push('CLOUDFLARE_ZONE_ID')
  if (TOKEN.length < 20) missing.push('CLOUDFLARE_API_TOKEN')
  if (!PLATFORM_ROOT || !WORKER) missing.push('platform root / worker configuration')
  if (missing.length) throw new Error(`Missing Phase 4 Cloudflare configuration: ${missing.join(', ')}`)
}
function apiError(payload, status) {
  return [...(payload?.errors || []), ...(payload?.messages || [])].map((item) => typeof item === 'string' ? item : item?.message).filter(Boolean).join('; ') || `Cloudflare API returned HTTP ${status}`
}
async function cf(path, init = {}, expected = [200]) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const headers = new Headers(init.headers || {})
    headers.set('authorization', `Bearer ${TOKEN}`)
    headers.set('accept', 'application/json')
    if (init.body) headers.set('content-type', 'application/json')
    const response = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: controller.signal })
    const payload = await response.json().catch(() => ({}))
    if (!expected.includes(response.status) || payload?.success === false) throw new Error(apiError(payload, response.status))
    return payload
  } finally { clearTimeout(timer) }
}
async function listAll(path, perPage = 100) {
  const rows = []
  for (let page = 1; page <= 100; page += 1) {
    const payload = await cf(`${path}${path.includes('?') ? '&' : '?'}page=${page}&per_page=${perPage}`)
    rows.push(...(Array.isArray(payload.result) ? payload.result : []))
    if (page >= Number(payload?.result_info?.total_pages || 1)) break
  }
  return rows
}
async function getZone() { return (await cf(`/zones/${ZONE_ID}`)).result }
async function getDns() { return listAll(`/zones/${ZONE_ID}/dns_records`) }
async function getRoutes() { return (await cf(`/zones/${ZONE_ID}/workers/routes`)).result || [] }
async function getCerts() { return (await cf(`/zones/${ZONE_ID}/ssl/certificate_packs?status=all`)).result || [] }
function certificateActive(pack) {
  const hosts = new Set((pack?.hosts || []).map(normalizeHost))
  return String(pack?.status || '') === 'active' && hosts.has(PLATFORM_ROOT) && hosts.has(`*.${PLATFORM_ROOT}`)
}
function snapshotDigest(snapshot) {
  return createHash('sha256').update(JSON.stringify({ zoneId: snapshot.zoneId, platformRoot: snapshot.platformRoot, dns: snapshot.dns, routes: snapshot.routes })).digest('hex')
}
export function selectRollbackState(dns, routes) {
  const selectedDns = dns.filter((record) => isPlatformHost(record?.name) && WEB_TYPES.has(String(record?.type || '').toUpperCase())).map((record) => ({
    type: record.type, name: record.name, content: record.content, proxied: Boolean(record.proxied), ttl: record.ttl || 1,
    ...(record.priority != null ? { priority: record.priority } : {}),
  })).sort((a, b) => `${a.name}|${a.type}|${a.content}`.localeCompare(`${b.name}|${b.type}|${b.content}`))
  const selectedRoutes = routes.filter(platformRoute).map((route) => ({ pattern: route.pattern, script: route.script || null }))
    .sort((a, b) => `${a.pattern}|${a.script || ''}`.localeCompare(`${b.pattern}|${b.script || ''}`))
  return { dns: selectedDns, routes: selectedRoutes }
}
async function captureRollbackState({ overwrite = false } = {}) {
  if (existsSync(STATE_FILE) && !overwrite) return JSON.parse(await readFile(STATE_FILE, 'utf8'))
  const [zone, dns, routes] = await Promise.all([getZone(), getDns(), getRoutes()])
  if (zone?.id !== ZONE_ID || zone?.account?.id !== ACCOUNT_ID) throw new Error('Cloudflare zone/account mismatch')
  const selected = selectRollbackState(dns, routes)
  const snapshot = { version: 1, capturedAt: new Date().toISOString(), zoneId: ZONE_ID, accountId: ACCOUNT_ID, platformRoot: PLATFORM_ROOT, worker: WORKER, ...selected }
  snapshot.sha256 = snapshotDigest(snapshot)
  await mkdir(dirname(STATE_FILE), { recursive: true })
  await writeFile(STATE_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 })
  return snapshot
}
async function readRollbackState() {
  if (!existsSync(STATE_FILE)) throw new Error(`Rollback snapshot is missing: ${STATE_FILE}`)
  const snapshot = JSON.parse(await readFile(STATE_FILE, 'utf8'))
  if (snapshot.zoneId !== ZONE_ID || snapshot.accountId !== ACCOUNT_ID || normalizeHost(snapshot.platformRoot) !== PLATFORM_ROOT) throw new Error('Rollback snapshot does not belong to this Cloudflare zone/platform')
  if (snapshot.sha256 !== snapshotDigest(snapshot)) throw new Error('Rollback snapshot integrity check failed')
  return snapshot
}
async function assertRollbackSnapshotCurrent(snapshot) {
  const [dns, routes] = await Promise.all([getDns(), getRoutes()])
  const current = selectRollbackState(dns, routes)
  if (JSON.stringify(current.dns) !== JSON.stringify(snapshot.dns) || JSON.stringify(current.routes) !== JSON.stringify(snapshot.routes)) {
    throw new Error('Platform DNS/Worker routing changed after the Phase 4 plan was captured. Re-run cloudflare:phase4:platform:plan, review the new snapshot, then retry cutover.')
  }
}
async function probeUrl(url) {
  if (!url) return { url, skipped: true }
  const target = new URL(url)
  const probe = new URL(MARKER_PATH, target.origin)
  try {
    const response = await fetch(probe, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
    const marker = response.headers.get(MARKER_HEADER)
    return { url: target.origin, ok: response.ok && marker === MARKER_VALUE, status: response.status, marker }
  } catch (error) { return { url: target.origin, ok: false, error: error instanceof Error ? error.message : String(error) } }
}
async function stagingGate() {
  if (REQUIRE_STAGING_GATE && (!STAGING_ROOT_URL || !STAGING_TENANT_URL)) throw new Error('Cutover requires CLOUDFLARE_PHASE4_STAGING_ROOT_URL and CLOUDFLARE_PHASE4_STAGING_TENANT_URL')
  const probes = await Promise.all([probeUrl(STAGING_ROOT_URL), probeUrl(STAGING_TENANT_URL), probeUrl(STAGING_CUSTOM_URL)])
  const required = probes.filter((probe, index) => index < 2 || Boolean(STAGING_CUSTOM_URL)).filter((probe) => !probe.skipped)
  const failures = required.filter((probe) => !probe.ok)
  if (failures.length) throw new Error(`Staging Worker/tenant resolver gate failed: ${JSON.stringify(failures)}`)
  return probes
}
async function productionGate() {
  const root = await probeUrl(`https://${PLATFORM_ROOT}`)
  const tenantHost = PRODUCTION_TEST_SUBDOMAIN ? (PRODUCTION_TEST_SUBDOMAIN.includes('.') ? PRODUCTION_TEST_SUBDOMAIN : `${PRODUCTION_TEST_SUBDOMAIN}.${PLATFORM_ROOT}`) : ''
  const tenant = tenantHost ? await probeUrl(`https://${tenantHost}`) : { url: '', skipped: true }
  if (!root.ok || (tenantHost && !tenant.ok)) throw new Error(`Production platform gate failed: ${JSON.stringify([root, tenant])}`)
  return [root, tenant]
}
async function deleteDns(id) { await cf(`/zones/${ZONE_ID}/dns_records/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
async function createDns(record) {
  const body = { type: record.type, name: record.name, content: record.content, proxied: Boolean(record.proxied), ttl: record.ttl || 1, ...(record.priority != null ? { priority: record.priority } : {}) }
  await cf(`/zones/${ZONE_ID}/dns_records`, { method: 'POST', body: JSON.stringify(body) }, [200, 201])
}
async function deleteRoute(id) { await cf(`/zones/${ZONE_ID}/workers/routes/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
async function createRoute(route) { await cf(`/zones/${ZONE_ID}/workers/routes`, { method: 'POST', body: JSON.stringify(route.script ? { pattern: route.pattern, script: route.script } : { pattern: route.pattern }) }, [200, 201]) }
async function restoreSnapshot(snapshot) {
  const [dns, routes] = await Promise.all([getDns(), getRoutes()])
  for (const record of dns.filter((row) => isPlatformHost(row?.name) && WEB_TYPES.has(String(row?.type || '').toUpperCase()))) await deleteDns(record.id)
  for (const record of snapshot.dns) await createDns(record)
  for (const route of routes.filter(platformRoute)) await deleteRoute(route.id)
  for (const route of snapshot.routes) await createRoute(route)
}
function runPhase3(mode) {
  const child = spawnSync(process.execPath, ['scripts/cloudflare-phase3.mjs', mode], {
    cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, CLOUDFLARE_PHASE3_ALLOW_PLATFORM_DNS_REPLACE: mode === 'cutover' ? 'true' : process.env.CLOUDFLARE_PHASE3_ALLOW_PLATFORM_DNS_REPLACE || 'false' },
  })
  if (child.status !== 0) throw new Error(`cloudflare-phase3 ${mode} failed with exit code ${child.status}`)
}
async function assertCertificate() {
  const certs = await getCerts()
  if (!certs.some(certificateActive)) throw new Error(`Advanced Certificate is not ACTIVE for ${PLATFORM_ROOT} and *.${PLATFORM_ROOT}`)
}

async function main(mode) {
  assertConfig()
  if (!['plan', 'cutover', 'verify', 'rollback'].includes(mode)) throw new Error('Usage: node scripts/cloudflare-phase4-platform.mjs <plan|cutover|verify|rollback>')
  if (mode === 'plan') {
    const snapshot = await captureRollbackState({ overwrite: true })
    console.log(JSON.stringify({ mode: 'READ_ONLY', stateFile: STATE_FILE, capturedAt: snapshot.capturedAt, platformWebDnsRecords: snapshot.dns.length, platformWorkerRoutes: snapshot.routes.length, sha256: snapshot.sha256 }, null, 2))
    return
  }
  if (mode === 'cutover') {
    if (!ALLOW_CUTOVER) throw new Error('Platform cutover blocked. Set CLOUDFLARE_PHASE4_ALLOW_PLATFORM_CUTOVER=true only after reviewing the rollback snapshot.')
    const snapshot = await captureRollbackState()
    await assertRollbackSnapshotCurrent(snapshot)
    await assertCertificate()
    const staging = await stagingGate()
    console.log(`Phase 4 staging gate passed: ${JSON.stringify(staging)}`)
    runPhase3('cutover')
    try {
      const production = await productionGate()
      console.log(`Phase 4 platform cutover passed: ${JSON.stringify(production)}`)
    } catch (error) {
      if (AUTO_ROLLBACK) {
        console.error('Post-cutover gate failed; restoring the exact pre-cutover platform DNS/Worker routes.')
        await restoreSnapshot(snapshot)
      }
      throw error
    }
    return
  }
  if (mode === 'verify') {
    await assertCertificate()
    runPhase3('verify')
    console.log(`Phase 4 platform verification passed: ${JSON.stringify(await productionGate())}`)
    return
  }
  if (!ALLOW_ROLLBACK) throw new Error('Platform rollback blocked. Set CLOUDFLARE_PHASE4_ALLOW_PLATFORM_ROLLBACK=true after confirming rollback is required.')
  const snapshot = await readRollbackState()
  await restoreSnapshot(snapshot)
  console.log(`Platform DNS/Worker routes restored from ${STATE_FILE}. Database domain records were not modified.`)
}

const invokedDirectly = process.argv[1]?.endsWith('cloudflare-phase4-platform.mjs')
if (invokedDirectly) main(process.argv[2] || 'plan').catch((error) => { console.error(`[cloudflare-phase4-platform] ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
