#!/usr/bin/env node
import dns from 'node:dns/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const envFile = process.env.CLOUDFLARE_PHASE3_ENV_FILE || '.env'
try {
  process.loadEnvFile(envFile)
} catch (error) {
  if (process.env.CLOUDFLARE_PHASE3_ENV_FILE) throw new Error(`Could not load CLOUDFLARE_PHASE3_ENV_FILE=${envFile}: ${error instanceof Error ? error.message : String(error)}`)
}

const API_BASE = (process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/$/, '')
const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim()
const ZONE_ID = (process.env.CLOUDFLARE_ZONE_ID || '').trim()
const TOKEN = (process.env.CLOUDFLARE_API_TOKEN || '').trim()
const ZONE_NAME = normalizeHost(process.env.CLOUDFLARE_ZONE_NAME || 'opygen.com')
const WORKER = (process.env.CLOUDFLARE_WORKER_SCRIPT_NAME || 'opygen-real-estate-frontend').trim()
const PLATFORM_ROOT = normalizeHost(process.env.CLOUDFLARE_PLATFORM_ROOT_DOMAIN || 'realestate.opygen.com')
const FALLBACK_ORIGIN = normalizeHost(process.env.CLOUDFLARE_SAAS_FALLBACK_ORIGIN || 'saas-fallback.opygen.com')
const CNAME_TARGET = normalizeHost(process.env.CLOUDFLARE_SAAS_CNAME_TARGET || 'customers.opygen.com')
const PLAN_FILE = resolvePath(process.env.CLOUDFLARE_PHASE3_PLAN_FILE || '.cloudflare/phase3-plan.json')
const ALLOW_PLATFORM_REPLACE = boolEnv('CLOUDFLARE_PHASE3_ALLOW_PLATFORM_DNS_REPLACE', false)
const REQUIRE_LIVE_GATE = boolEnv('CLOUDFLARE_PHASE3_REQUIRE_LIVE_GATE', false)
const TEST_SUBDOMAIN = normalizeHost(process.env.CLOUDFLARE_PHASE3_TEST_SUBDOMAIN || '')
const TEST_CUSTOM_DOMAIN = normalizeHost(process.env.CLOUDFLARE_PHASE3_TEST_CUSTOM_DOMAIN || '')
const MANAGED_COMMENT_PREFIX = 'opygen-managed:cloudflare-phase3:'
const ORIGINLESS_IPV6 = '100::'
const LIVE_MARKER_PATH = '/.well-known/opygen-domain-check'
const LIVE_MARKER_HEADER = 'x-opygen-domain-check'
const LIVE_MARKER_VALUE = 'real-estate-saas'
const REQUIRED_CERT_HOSTS = [ZONE_NAME, PLATFORM_ROOT, `*.${PLATFORM_ROOT}`]

function normalizeHost(value) {
  return String(value || '').trim().replace(/\.$/, '').toLowerCase()
}

function boolEnv(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  return /^(1|true|yes|on)$/i.test(raw)
}

function requiredConfig() {
  const missing = []
  if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) missing.push('CLOUDFLARE_ACCOUNT_ID (32-character account ID)')
  if (!/^[a-f0-9]{32}$/i.test(ZONE_ID)) missing.push('CLOUDFLARE_ZONE_ID (32-character zone ID)')
  if (TOKEN.length < 20) missing.push('CLOUDFLARE_API_TOKEN')
  if (!ZONE_NAME || !PLATFORM_ROOT || !FALLBACK_ORIGIN || !CNAME_TARGET || !WORKER) missing.push('Cloudflare Phase 3 host/script configuration')
  if (missing.length) throw new Error(`Missing Cloudflare Phase 3 configuration: ${missing.join(', ')}`)
}

function apiError(payload, status) {
  const messages = [...(Array.isArray(payload?.errors) ? payload.errors : []), ...(Array.isArray(payload?.messages) ? payload.messages : [])]
    .map((item) => typeof item === 'string' ? item : item?.message)
    .filter(Boolean)
  return messages.length ? messages.join('; ') : `Cloudflare API returned HTTP ${status}`
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
    if (!expected.includes(response.status) || payload?.success === false) {
      const error = new Error(apiError(payload, response.status))
      error.status = response.status
      error.payload = payload
      throw error
    }
    return payload
  } finally {
    clearTimeout(timer)
  }
}

async function listAll(path, perPage = 100) {
  const rows = []
  for (let page = 1; page <= 100; page += 1) {
    const separator = path.includes('?') ? '&' : '?'
    const payload = await cf(`${path}${separator}page=${page}&per_page=${perPage}`)
    rows.push(...(Array.isArray(payload.result) ? payload.result : []))
    const totalPages = Number(payload?.result_info?.total_pages || 1)
    if (page >= totalPages) break
  }
  return rows
}

export function managedDnsSpecs() {
  return [
    { role: 'fallback-origin', type: 'AAAA', name: FALLBACK_ORIGIN, content: ORIGINLESS_IPV6, proxied: true },
    { role: 'saas-cname-target', type: 'CNAME', name: CNAME_TARGET, content: FALLBACK_ORIGIN, proxied: true },
    { role: 'platform-root', type: 'AAAA', name: PLATFORM_ROOT, content: ORIGINLESS_IPV6, proxied: true },
    { role: 'platform-wildcard', type: 'AAAA', name: `*.${PLATFORM_ROOT}`, content: ORIGINLESS_IPV6, proxied: true },
  ]
}

function isPlatformNamespace(name) {
  const host = normalizeHost(name)
  return host === PLATFORM_ROOT || host === `*.${PLATFORM_ROOT}` || host.endsWith(`.${PLATFORM_ROOT}`)
}

export function routePatternForDnsName(name) {
  const host = normalizeHost(name)
  return host ? `${host}/*` : ''
}

export function buildRoutePlan(dnsRecords, stage = 'bootstrap') {
  const names = new Set([ZONE_NAME])
  for (const record of dnsRecords) {
    const name = normalizeHost(record?.name)
    if (name) names.add(name)
  }
  const desired = new Map()
  desired.set('*/*', WORKER)
  for (const name of names) {
    if (name === FALLBACK_ORIGIN || name === CNAME_TARGET) continue
    const pattern = routePatternForDnsName(name)
    if (!pattern) continue
    desired.set(pattern, stage === 'cutover' && isPlatformNamespace(name) ? WORKER : null)
  }
  // These routes are required even when the DNS records do not yet exist.
  desired.set(`${PLATFORM_ROOT}/*`, stage === 'cutover' ? WORKER : null)
  desired.set(`*.${PLATFORM_ROOT}/*`, stage === 'cutover' ? WORKER : null)
  return [...desired.entries()].map(([pattern, script]) => ({ pattern, script }))
}

export function certificateCovers(pack) {
  const hosts = new Set((Array.isArray(pack?.hosts) ? pack.hosts : []).map(normalizeHost))
  return REQUIRED_CERT_HOSTS.every((host) => hosts.has(normalizeHost(host)))
}

function certificateUsable(pack) {
  if (!certificateCovers(pack)) return false
  const status = String(pack?.status || '')
  return status === 'active' || ['initializing', 'pending_validation', 'pending_issuance', 'pending_deployment'].includes(status)
}

function certificateActive(pack) {
  return certificateCovers(pack) && String(pack?.status || '') === 'active'
}

function recordMatches(record, spec) {
  return String(record?.type || '').toUpperCase() === spec.type
    && normalizeHost(record?.name) === normalizeHost(spec.name)
    && normalizeHost(record?.content) === normalizeHost(spec.content)
    && Boolean(record?.proxied) === Boolean(spec.proxied)
}

async function getZone() {
  return (await cf(`/zones/${ZONE_ID}`)).result
}

async function getDnsRecords() {
  return listAll(`/zones/${ZONE_ID}/dns_records`)
}

async function getRoutes() {
  return (await cf(`/zones/${ZONE_ID}/workers/routes`)).result || []
}

async function getFallback() {
  try { return (await cf(`/zones/${ZONE_ID}/custom_hostnames/fallback_origin`, {}, [200, 404])).result || null }
  catch (error) { if (error.status === 404) return null; throw error }
}

async function getCertificatePacks() {
  const payload = await cf(`/zones/${ZONE_ID}/ssl/certificate_packs?status=all`)
  return Array.isArray(payload.result) ? payload.result : []
}

async function currentNameservers() {
  try { return (await dns.resolveNs(ZONE_NAME)).map(normalizeHost).sort() } catch { return [] }
}

export function nameserversMatch(current, assigned) {
  const left = [...new Set((current || []).map(normalizeHost))].sort()
  const right = [...new Set((assigned || []).map(normalizeHost))].sort()
  return left.length > 0 && left.length === right.length && left.every((item, index) => item === right[index])
}

async function buildSnapshot(stage) {
  const [zone, dnsRecords, routes, fallback, certificatePacks, liveNs] = await Promise.all([
    getZone(), getDnsRecords(), getRoutes(), getFallback(), getCertificatePacks(), currentNameservers(),
  ])
  const assignedNs = (zone?.name_servers || []).map(normalizeHost).sort()
  return {
    generatedAt: new Date().toISOString(),
    stage,
    zone: { id: zone?.id, name: zone?.name, status: zone?.status, accountId: zone?.account?.id, assignedNameservers: assignedNs, liveNameservers: liveNs, authoritative: nameserversMatch(liveNs, assignedNs) },
    managed: { platformRoot: PLATFORM_ROOT, platformWildcard: `*.${PLATFORM_ROOT}`, fallbackOrigin: FALLBACK_ORIGIN, cnameTarget: CNAME_TARGET, worker: WORKER, certificateHosts: REQUIRED_CERT_HOSTS },
    fallback,
    certificates: certificatePacks.filter(certificateCovers).map((pack) => ({ id: pack.id, type: pack.type, status: pack.status, hosts: pack.hosts, validationMethod: pack.validation_method })),
    dnsInventory: dnsRecords.map((record) => ({ id: record.id, type: record.type, name: record.name, content: record.content, proxied: record.proxied, ttl: record.ttl, comment: record.comment || '' })),
    workerRoutes: routes.map((route) => ({ id: route.id, pattern: route.pattern, script: route.script || null })),
    desiredRoutes: buildRoutePlan(dnsRecords, stage),
  }
}

async function writePlan(snapshot) {
  await mkdir(dirname(PLAN_FILE), { recursive: true })
  await writeFile(PLAN_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 })
  console.log(`Phase 3 plan written to ${PLAN_FILE}`)
}

function validateZone(snapshot, { requireActive = true, requireAuthoritative = false } = {}) {
  if (normalizeHost(snapshot.zone.name) !== ZONE_NAME) throw new Error(`CLOUDFLARE_ZONE_ID belongs to ${snapshot.zone.name || 'an unknown zone'}, expected ${ZONE_NAME}`)
  if (snapshot.zone.accountId !== ACCOUNT_ID) throw new Error('Cloudflare zone/account mismatch')
  if (requireActive && snapshot.zone.status !== 'active') throw new Error(`Cloudflare zone is ${snapshot.zone.status || 'unknown'}, expected active`)
  if (requireAuthoritative && !snapshot.zone.authoritative) {
    throw new Error(`Cloudflare is not authoritative for ${ZONE_NAME}. Update the registrar nameservers to: ${snapshot.zone.assignedNameservers.join(', ')}`)
  }
}

async function createDns(spec) {
  const payload = await cf(`/zones/${ZONE_ID}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type: spec.type, name: spec.name, content: spec.content, proxied: spec.proxied, ttl: 1, comment: `${MANAGED_COMMENT_PREFIX}${spec.role}` }),
  }, [200, 201])
  return payload.result
}

async function deleteDns(id) {
  await cf(`/zones/${ZONE_ID}/dns_records/${encodeURIComponent(id)}`, { method: 'DELETE' }, [200])
}

async function ensureDnsSpec(spec, dnsRecords, { allowReplace = false } = {}) {
  const sameName = dnsRecords.filter((record) => normalizeHost(record.name) === normalizeHost(spec.name))
  const match = sameName.find((record) => recordMatches(record, spec))
  const conflicts = sameName.filter((record) => !recordMatches(record, spec))
  if (match && conflicts.length === 0) return { status: 'ok', record: match }
  if (conflicts.length || (sameName.length && !match)) {
    if (!allowReplace) {
      throw new Error(`DNS conflict at ${spec.name}. Existing ${sameName.map((row) => `${row.type} ${row.content}`).join(', ')} was not modified. Review ${PLAN_FILE} before cutover.`)
    }
    for (const record of sameName) await deleteDns(record.id)
  }
  return { status: conflicts.length || sameName.length ? 'replaced' : 'created', record: await createDns(spec) }
}

async function ensureFallbackOrigin() {
  const current = await getFallback()
  if (normalizeHost(current?.origin) === FALLBACK_ORIGIN && ['active', 'pending_deployment', 'initializing'].includes(String(current?.status || ''))) return current
  return (await cf(`/zones/${ZONE_ID}/custom_hostnames/fallback_origin`, { method: 'PUT', body: JSON.stringify({ origin: FALLBACK_ORIGIN }) }, [200])).result
}

async function ensureCertificate(certificatePacks) {
  const existing = certificatePacks.find(certificateUsable)
  if (existing) return { status: 'existing', certificate: existing }
  try {
    const payload = await cf(`/zones/${ZONE_ID}/ssl/certificate_packs/order`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'advanced',
        hosts: REQUIRED_CERT_HOSTS,
        validation_method: 'txt',
        validity_days: 90,
        certificate_authority: 'lets_encrypt',
        cloudflare_branding: false,
      }),
    }, [200, 201])
    return { status: 'ordered', certificate: payload.result }
  } catch (error) {
    throw new Error(`Could not order the required multi-level wildcard certificate. Confirm Advanced Certificate Manager is enabled and the API token has SSL and Certificates Write permission. ${error.message}`)
  }
}

async function createRoute(pattern, script) {
  const body = script ? { pattern, script } : { pattern }
  return (await cf(`/zones/${ZONE_ID}/workers/routes`, { method: 'POST', body: JSON.stringify(body) }, [200, 201])).result
}

async function updateRoute(id, pattern, script) {
  const body = script ? { pattern, script } : { pattern }
  return (await cf(`/zones/${ZONE_ID}/workers/routes/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }, [200])).result
}

async function ensureRoutes(dnsRecords, stage) {
  const current = await getRoutes()
  const byPattern = new Map(current.map((route) => [route.pattern, route]))
  const desired = buildRoutePlan(dnsRecords, stage)
  // Specific exclusions/worker routes first. Broad SaaS route is deliberately last.
  const ordered = [...desired.filter((item) => item.pattern !== '*/*'), ...desired.filter((item) => item.pattern === '*/*')]
  for (const item of ordered) {
    const existing = byPattern.get(item.pattern)
    const existingScript = existing?.script || null
    if (!existing) {
      await createRoute(item.pattern, item.script)
      continue
    }
    if (existingScript === item.script) continue
    const platformPattern = item.pattern === `${PLATFORM_ROOT}/*` || item.pattern === `*.${PLATFORM_ROOT}/*` || item.pattern.endsWith(`.${PLATFORM_ROOT}/*`)
    if (stage === 'cutover' && platformPattern && item.script === WORKER && existingScript === null && ALLOW_PLATFORM_REPLACE) {
      await updateRoute(existing.id, item.pattern, item.script)
      continue
    }
    throw new Error(`Worker route conflict for ${item.pattern}: existing=${existingScript || '<no script>'}, desired=${item.script || '<no script>'}. No route was overwritten.`)
  }
}

async function probe(host) {
  if (!host) return { host, skipped: true }
  try {
    const response = await fetch(`https://${host}${LIVE_MARKER_PATH}`, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
    const marker = response.headers.get(LIVE_MARKER_HEADER)
    return { host, ok: response.ok && marker === LIVE_MARKER_VALUE, status: response.status, marker }
  } catch (error) {
    return { host, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function liveGate() {
  const tenantHost = TEST_SUBDOMAIN ? (TEST_SUBDOMAIN.includes('.') ? TEST_SUBDOMAIN : `${TEST_SUBDOMAIN}.${PLATFORM_ROOT}`) : ''
  const probes = await Promise.all([probe(PLATFORM_ROOT), probe(tenantHost), probe(TEST_CUSTOM_DOMAIN)])
  const required = [probes[0], ...(REQUIRE_LIVE_GATE || tenantHost ? [probes[1]] : []), ...(REQUIRE_LIVE_GATE || TEST_CUSTOM_DOMAIN ? [probes[2]] : [])]
  if (REQUIRE_LIVE_GATE && (!tenantHost || !TEST_CUSTOM_DOMAIN)) throw new Error('Live gate requires CLOUDFLARE_PHASE3_TEST_SUBDOMAIN and CLOUDFLARE_PHASE3_TEST_CUSTOM_DOMAIN')
  const failures = required.filter((item) => !item.skipped && !item.ok)
  if (failures.length) throw new Error(`Live HTTPS gate failed: ${JSON.stringify(failures)}`)
  return probes
}

async function run(mode) {
  requiredConfig()
  if (!['plan', 'bootstrap', 'cutover', 'verify'].includes(mode)) throw new Error('Usage: node scripts/cloudflare-phase3.mjs <plan|bootstrap|cutover|verify>')
  let snapshot = await buildSnapshot(mode === 'cutover' ? 'cutover' : 'bootstrap')
  await writePlan(snapshot)
  validateZone(snapshot, { requireActive: mode !== 'plan', requireAuthoritative: mode === 'cutover' || mode === 'verify' })

  if (mode === 'plan') {
    console.log(`Read-only plan complete. Cloudflare authoritative=${snapshot.zone.authoritative}. No DNS, certificate, fallback-origin, or Worker route was changed.`)
    return
  }

  if (mode === 'bootstrap') {
    const dnsRecords = await getDnsRecords()
    const specs = managedDnsSpecs().filter((item) => item.role === 'fallback-origin' || item.role === 'saas-cname-target')
    for (const spec of specs) await ensureDnsSpec(spec, dnsRecords, { allowReplace: false })
    const certs = await getCertificatePacks()
    const certificate = await ensureCertificate(certs)
    const fallback = await ensureFallbackOrigin()
    await ensureRoutes(await getDnsRecords(), 'bootstrap')
    console.log(`Bootstrap applied safely. Certificate=${certificate.certificate?.status || certificate.status}; fallback=${fallback?.status || 'pending'}. Platform DNS was NOT switched.`)
    return
  }

  if (mode === 'cutover') {
    if (!ALLOW_PLATFORM_REPLACE) throw new Error('Cutover blocked. Set CLOUDFLARE_PHASE3_ALLOW_PLATFORM_DNS_REPLACE=true only after reviewing the plan file.')
    const certs = await getCertificatePacks()
    if (!certs.some(certificateActive)) throw new Error(`Cutover blocked until an Advanced Certificate is ACTIVE for ${REQUIRED_CERT_HOSTS.join(', ')}`)
    const fallback = await getFallback()
    if (normalizeHost(fallback?.origin) !== FALLBACK_ORIGIN || fallback?.status !== 'active') throw new Error(`Cutover blocked until fallback origin ${FALLBACK_ORIGIN} is active`)
    let dnsRecords = await getDnsRecords()
    for (const spec of managedDnsSpecs().filter((item) => item.role.startsWith('platform-'))) {
      await ensureDnsSpec(spec, dnsRecords, { allowReplace: true })
      dnsRecords = await getDnsRecords()
    }
    await ensureRoutes(dnsRecords, 'cutover')
    console.log('Platform DNS and Worker routes switched to Cloudflare. Unrelated DNS records were preserved.')
    return
  }

  // verify
  snapshot = await buildSnapshot('cutover')
  await writePlan(snapshot)
  validateZone(snapshot, { requireActive: true, requireAuthoritative: true })
  const certs = await getCertificatePacks()
  if (!certs.some(certificateActive)) throw new Error('Required Advanced Certificate is not active')
  const fallback = await getFallback()
  if (normalizeHost(fallback?.origin) !== FALLBACK_ORIGIN || fallback?.status !== 'active') throw new Error('Cloudflare for SaaS fallback origin is not active')
  const dnsRecords = await getDnsRecords()
  for (const spec of managedDnsSpecs()) {
    if (!dnsRecords.some((record) => recordMatches(record, spec))) throw new Error(`Managed DNS record is missing or incorrect: ${spec.name}`)
  }
  const routes = await getRoutes()
  const desired = buildRoutePlan(dnsRecords, 'cutover')
  for (const item of desired) {
    const actual = routes.find((route) => route.pattern === item.pattern)
    if (!actual || (actual.script || null) !== item.script) throw new Error(`Worker route verification failed for ${item.pattern}`)
  }
  const probes = await liveGate()
  console.log(`Phase 3 verification passed. HTTPS probes: ${JSON.stringify(probes)}`)
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href
if (invokedDirectly) {
  run(process.argv[2] || 'plan').catch((error) => {
    console.error(`[cloudflare-phase3] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
