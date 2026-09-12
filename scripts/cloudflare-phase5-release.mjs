import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { resolve4, resolve6, resolveCname, resolveMx, resolveTxt } from 'node:dns/promises'

const command = String(process.argv[2] || 'preflight').trim().toLowerCase()
const truthy = (value) => /^(1|true|yes|on)$/i.test(String(value || '').trim())
const normalizeHost = (value = '') => String(value).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/:\d+$/, '')
const requireEnv = (name) => {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
const optionalUrl = (name) => {
  const raw = String(process.env[name] || '').trim()
  if (!raw) return ''
  const parsed = new URL(raw)
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error(`${name} must use https://`)
  }
  return parsed.origin
}
const STATE_FILE = resolve(process.env.CLOUDFLARE_PHASE5_STATE_FILE || '.cloudflare/phase5-release-state.json')
const MARKER_PATH = '/.well-known/opygen-domain-check'
const MARKER_HEADER = 'x-opygen-domain-check'
const MARKER_VALUE = 'real-estate-saas'
const STABILITY_HOURS = Math.max(1, Number(process.env.CLOUDFLARE_PHASE5_STABILITY_HOURS || 72))
const MAX_VERIFY_AGE_MINUTES = Math.max(5, Number(process.env.CLOUDFLARE_PHASE5_MAX_VERIFY_AGE_MINUTES || 60))
const EXACT_PLATFORM_DOMAINS = new Set([
  normalizeHost(process.env.PLATFORM_ROOT_DOMAIN || 'realestate.opygen.com'),
  `www.${normalizeHost(process.env.PLATFORM_ROOT_DOMAIN || 'realestate.opygen.com')}`,
  `*.${normalizeHost(process.env.PLATFORM_ROOT_DOMAIN || 'realestate.opygen.com')}`,
])

const redact = (value) => value ? `${String(value).slice(0, 4)}...${String(value).slice(-4)}` : ''
const hash = (value) => createHash('sha256').update(String(value)).digest('hex')

async function fetchWithTimeout(url, init = {}, timeoutMs = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(url, { ...init, signal: controller.signal, redirect: init.redirect || 'manual' }) }
  finally { clearTimeout(timer) }
}

async function markerProbe(origin) {
  if (!origin) return { skipped: true }
  const response = await fetchWithTimeout(`${origin}${MARKER_PATH}`, { headers: { accept: 'text/plain,*/*' } })
  return { origin, status: response.status, marker: response.headers.get(MARKER_HEADER), ok: response.status === 200 && response.headers.get(MARKER_HEADER) === MARKER_VALUE }
}

async function pageProbe(origin, expectedStatus = 200) {
  if (!origin) return { skipped: true }
  const response = await fetchWithTimeout(`${origin}/`, { headers: { accept: 'text/html,*/*' } })
  return { origin, status: response.status, ok: response.status === expectedStatus }
}

async function pathProbe(origin, path, expectedStatus) {
  if (!origin) return { skipped: true }
  const response = await fetchWithTimeout(`${origin}${path}`, { headers: { accept: 'text/html,*/*' } })
  return { origin, path, status: response.status, location: response.headers.get('location'), ok: response.status === expectedStatus }
}

async function socketPollingProbe(origin) {
  if (!origin) return { skipped: true }
  const target = `${origin}/socket.io/?EIO=4&transport=polling&t=phase5-${Date.now()}`
  const response = await fetchWithTimeout(target, { headers: { accept: '*/*' } })
  const body = await response.text().catch(() => '')
  let handshake = null
  if (response.status === 200 && body.startsWith('0')) {
    try { handshake = JSON.parse(body.slice(1)) } catch { handshake = null }
  }
  const upgrades = Array.isArray(handshake?.upgrades) ? handshake.upgrades : []
  return { origin, status: response.status, websocketAdvertised: upgrades.includes('websocket'), ok: response.status === 200 && Boolean(handshake?.sid) && upgrades.includes('websocket') }
}

async function verifyEnvironment(prefix, { persistProduction = false } = {}) {
  const root = optionalUrl(`${prefix}_ROOT_URL`)
  const tenant = optionalUrl(`${prefix}_TENANT_URL`)
  const custom = optionalUrl(`${prefix}_CUSTOM_URL`)
  if (!root || !tenant || !custom) throw new Error(`${prefix}_ROOT_URL, ${prefix}_TENANT_URL and ${prefix}_CUSTOM_URL are required`)
  const oldSubdomain = optionalUrl(`${prefix}_OLD_SUBDOMAIN_URL`)
  const suspended = optionalUrl(`${prefix}_SUSPENDED_URL`)
  const unpublished = optionalUrl(`${prefix}_UNPUBLISHED_URL`)

  const checks = {
    markerRoot: await markerProbe(root),
    markerTenant: await markerProbe(tenant),
    markerCustom: await markerProbe(custom),
    root: await pageProbe(root),
    tenant: await pageProbe(tenant),
    custom: await pageProbe(custom),
    tenantPortalIsolation: await pathProbe(tenant, '/portal/__phase5_cross_tenant_probe__', 404),
    customPortalIsolation: await pathProbe(custom, '/portal/__phase5_cross_tenant_probe__', 404),
    socket: await socketPollingProbe(root),
    oldSubdomain: oldSubdomain ? await pathProbe(oldSubdomain, '/', 308) : { skipped: true },
    suspended: suspended ? await pathProbe(suspended, '/', 423) : { skipped: true },
    unpublished: unpublished ? await pathProbe(unpublished, '/', 404) : { skipped: true },
  }
  const failures = Object.entries(checks).filter(([, result]) => !result.skipped && !result.ok)
  if (failures.length) throw new Error(`${prefix} verification failed: ${JSON.stringify(Object.fromEntries(failures))}`)

  if (persistProduction) {
    const now = new Date()
    let state = {}
    if (existsSync(STATE_FILE)) state = JSON.parse(await readFile(STATE_FILE, 'utf8'))
    if (!state.firstVerifiedAt) state.firstVerifiedAt = now.toISOString()
    state.lastVerifiedAt = now.toISOString()
    state.productionOriginsHash = hash([root, tenant, custom].join('|'))
    state.checks = checks
    await mkdir(dirname(STATE_FILE), { recursive: true })
    await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  }
  console.log(JSON.stringify({ prefix, checks }, null, 2))
}

async function dnsMatrix() {
  const raw = requireEnv('CLOUDFLARE_PHASE5_DNS_MATRIX_JSON')
  let rows
  try { rows = JSON.parse(raw) } catch { throw new Error('CLOUDFLARE_PHASE5_DNS_MATRIX_JSON must be valid JSON') }
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('CLOUDFLARE_PHASE5_DNS_MATRIX_JSON must be a non-empty array')
  const cnameTarget = normalizeHost(requireEnv('CLOUDFLARE_SAAS_CNAME_TARGET'))
  const supportedProviders = new Set(['cloudflare', 'namecheap', 'godaddy', 'hostinger', 'other'])
  const results = []
  for (const row of rows) {
    const provider = String(row?.provider || '').trim().toLowerCase()
    const hostname = normalizeHost(row?.hostname || '')
    const mode = String(row?.mode || 'cname').trim().toLowerCase()
    if (!supportedProviders.has(provider) || !hostname || !['cname', 'apex'].includes(mode)) throw new Error(`Invalid DNS matrix row: ${JSON.stringify(row)}`)
    const result = { provider, hostname, mode, routing: false, marker: false, emailPreserved: true }
    if (mode === 'cname') {
      const cnames = (await resolveCname(hostname).catch(() => [])).map(normalizeHost)
      result.routing = cnames.includes(cnameTarget)
      result.cnames = cnames
    } else {
      const [a4, a6] = await Promise.all([resolve4(hostname).catch(() => []), resolve6(hostname).catch(() => [])])
      result.routing = a4.length > 0 || a6.length > 0
      result.addresses = [...a4, ...a6]
    }
    const marker = await markerProbe(`https://${hostname}`).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    result.marker = Boolean(marker.ok)
    if (row?.emailDomain) {
      const emailDomain = normalizeHost(row.emailDomain)
      const [mx, txt] = await Promise.all([resolveMx(emailDomain).catch(() => []), resolveTxt(emailDomain).catch(() => [])])
      const flattenedTxt = txt.map((parts) => parts.join(''))
      result.emailPreserved = mx.length > 0 && (!row.requireSpf || flattenedTxt.some((entry) => entry.toLowerCase().startsWith('v=spf1')))
      result.emailRecords = { mxCount: mx.length, hasSpf: flattenedTxt.some((entry) => entry.toLowerCase().startsWith('v=spf1')) }
    }
    result.ok = result.routing && result.marker && result.emailPreserved
    results.push(result)
  }
  const failures = results.filter((row) => !row.ok)
  console.log(JSON.stringify({ results }, null, 2))
  if (failures.length) throw new Error(`DNS provider matrix failed: ${JSON.stringify(failures)}`)
}

function vercelUrl(path) {
  const url = new URL(path, 'https://api.vercel.com')
  const teamId = String(process.env.VERCEL_TEAM_ID || '').trim()
  if (teamId) url.searchParams.set('teamId', teamId)
  return url.toString()
}
async function vercelFetch(path, init = {}) {
  const token = requireEnv('VERCEL_API_TOKEN')
  const response = await fetchWithTimeout(vercelUrl(path), {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Vercel API ${response.status}: ${payload?.error?.message || payload?.message || JSON.stringify(payload)}`)
  return payload
}
async function listVercelProjectDomains() {
  const project = encodeURIComponent(requireEnv('VERCEL_PROJECT_ID_OR_NAME'))
  const rows = []
  let until = ''
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ limit: '100' })
    if (until) query.set('until', until)
    const payload = await vercelFetch(`/v9/projects/${project}/domains?${query.toString()}`)
    rows.push(...(Array.isArray(payload?.domains) ? payload.domains : []))
    const next = payload?.pagination?.next
    if (!next) break
    until = String(next)
  }
  return rows
}
async function vercelPlan() {
  const domains = await listVercelProjectDomains()
  const selected = domains.map((row) => normalizeHost(row?.name)).filter((name) => EXACT_PLATFORM_DOMAINS.has(name))
  const unrelated = domains.map((row) => normalizeHost(row?.name)).filter((name) => name && !EXACT_PLATFORM_DOMAINS.has(name))
  console.log(JSON.stringify({ mode: 'READ_ONLY', project: requireEnv('VERCEL_PROJECT_ID_OR_NAME'), token: redact(process.env.VERCEL_API_TOKEN), selected, unrelatedCount: unrelated.length }, null, 2))
}
async function assertStableVerification() {
  if (!existsSync(STATE_FILE)) throw new Error(`Production verification state is missing: ${STATE_FILE}`)
  const state = JSON.parse(await readFile(STATE_FILE, 'utf8'))
  const first = Date.parse(state.firstVerifiedAt || '')
  const last = Date.parse(state.lastVerifiedAt || '')
  if (!Number.isFinite(first) || !Number.isFinite(last)) throw new Error('Production verification timestamps are invalid')
  const stableMs = Date.now() - first
  const lastAgeMs = Date.now() - last
  if (stableMs < STABILITY_HOURS * 60 * 60 * 1000) throw new Error(`Vercel removal blocked until Cloudflare has been verified for at least ${STABILITY_HOURS} hours`)
  if (lastAgeMs > MAX_VERIFY_AGE_MINUTES * 60 * 1000) throw new Error(`Vercel removal blocked because the last production verification is older than ${MAX_VERIFY_AGE_MINUTES} minutes`)
}
async function vercelRemove() {
  if (!truthy(process.env.CLOUDFLARE_PHASE5_ALLOW_VERCEL_PROJECT_DOMAIN_REMOVAL)) {
    throw new Error('Vercel removal blocked. Set CLOUDFLARE_PHASE5_ALLOW_VERCEL_PROJECT_DOMAIN_REMOVAL=true only after the DB retirement gate and stability window pass.')
  }
  await assertStableVerification()
  const projectRaw = requireEnv('VERCEL_PROJECT_ID_OR_NAME')
  const project = encodeURIComponent(projectRaw)
  const domains = await listVercelProjectDomains()
  const selected = domains.map((row) => normalizeHost(row?.name)).filter((name) => EXACT_PLATFORM_DOMAINS.has(name))
  if (selected.length === 0) {
    console.log(JSON.stringify({ removed: [], message: 'No platform project domains remain on Vercel.' }, null, 2))
    return
  }
  const removed = []
  for (const domain of selected) {
    const response = await fetchWithTimeout(vercelUrl(`/v9/projects/${project}/domains/${encodeURIComponent(domain)}`), {
      method: 'DELETE', headers: { authorization: `Bearer ${requireEnv('VERCEL_API_TOKEN')}` },
    })
    if (!response.ok && response.status !== 404) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(`Failed removing ${domain} from Vercel project: ${response.status} ${payload?.error?.message || payload?.message || ''}`)
    }
    removed.push(domain)
  }
  console.log(JSON.stringify({ removed, project: projectRaw, next: ['Re-run production verification.', 'Revoke VERCEL_API_TOKEN from runtime secrets.', 'Remove VERCEL_PROJECT_ID_OR_NAME/VERCEL_TEAM_ID from runtime secrets.', 'Delete the Vercel project only after confirming no unrelated project domains/deployments are needed.'] }, null, 2))
}

function preflight() {
  const provider = String(process.env.DOMAIN_PROVIDER || '').trim().toLowerCase()
  if (provider !== 'cloudflare') throw new Error('DOMAIN_PROVIDER must be cloudflare for Phase 5 production')
  const required = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_SAAS_CNAME_TARGET']
  for (const name of required) requireEnv(name)
  if (truthy(process.env.CLOUDFLARE_PHASE5_ALLOW_VERCEL_PROJECT_DOMAIN_REMOVAL) && !process.env.VERCEL_API_TOKEN) throw new Error('VERCEL_API_TOKEN is required only for the explicit retirement command')
  console.log(JSON.stringify({ ok: true, provider, accountId: redact(process.env.CLOUDFLARE_ACCOUNT_ID), zoneId: redact(process.env.CLOUDFLARE_ZONE_ID), stabilityHours: STABILITY_HOURS, stateFile: STATE_FILE }, null, 2))
}

async function main() {
  if (command === 'preflight') return preflight()
  if (command === 'verify-staging') return verifyEnvironment('CLOUDFLARE_PHASE5_STAGING')
  if (command === 'verify-production') return verifyEnvironment('CLOUDFLARE_PHASE5_PRODUCTION', { persistProduction: true })
  if (command === 'verify-dns-matrix') return dnsMatrix()
  if (command === 'vercel-plan') return vercelPlan()
  if (command === 'vercel-remove') return vercelRemove()
  throw new Error('Usage: node scripts/cloudflare-phase5-release.mjs <preflight|verify-staging|verify-production|verify-dns-matrix|vercel-plan|vercel-remove>')
}

main().catch((error) => {
  console.error(`[cloudflare-phase5-release] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
