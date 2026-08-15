const baseUrl = process.env.LOAD_API_URL?.replace(/\/$/, '')
const organizationId = process.env.LOAD_ORGANIZATION_ID
if (!baseUrl || !organizationId) throw new Error('LOAD_API_URL and LOAD_ORGANIZATION_ID are required')
const target = (process.env.LOAD_TARGET || '').toLowerCase()
if (target !== 'staging' && !/localhost|127\.0\.0\.1/i.test(baseUrl) && process.env.ALLOW_PRODUCTION_LOAD_TEST !== 'true') {
  throw new Error('Refusing to run write load checks outside an explicitly marked staging/local target.')
}

const readIterations = Math.max(1, Number(process.env.LOAD_READ_ITERATIONS || 30))
const writeIterations = Math.min(8, Math.max(1, Number(process.env.LOAD_WRITE_ITERATIONS || 5)))
const concurrency = Math.max(1, Number(process.env.LOAD_CONCURRENCY || 5))
const results = []

const percentile = (values, p) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
}

const request = async (name, url, options = {}) => {
  const started = performance.now()
  try {
    const response = await fetch(url, options)
    await response.arrayBuffer()
    results.push({ name, ms: performance.now() - started, ok: response.ok, status: response.status })
  } catch (error) {
    results.push({ name, ms: performance.now() - started, ok: false, status: 0, error: error instanceof Error ? error.message : String(error) })
  }
}

const resolveDashboardHeaders = async () => {
  if (process.env.LOAD_AUTH_TOKEN) return { authorization: `Bearer ${process.env.LOAD_AUTH_TOKEN}` }
  const email = process.env.LOAD_USER_EMAIL
  const password = process.env.LOAD_USER_PASSWORD
  if (!email || !password) return null
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(`Staging load-test login failed with HTTP ${response.status}`)
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  const cookie = cookies.map((value) => value.split(';', 1)[0]).filter(Boolean).join('; ')
  if (!cookie) throw new Error('Staging load-test login did not return session cookies')
  return { cookie }
}

const dashboardHeaders = await resolveDashboardHeaders()
const jobs = []
for (let index = 0; index < readIterations; index += 1) {
  jobs.push(() => request('public-property-search', `${baseUrl}/api/v1/property/public/${encodeURIComponent(organizationId)}?page=1&limit=20`))
  if (dashboardHeaders) jobs.push(() => request('tenant-dashboard', `${baseUrl}/api/v1/dashboard/overview`, { headers: dashboardHeaders }))
}
for (let index = 0; index < writeIterations; index += 1) {
  jobs.push(() => {
    const suffix = `${Date.now()}${index}${Math.floor(Math.random() * 100000)}`.slice(-8)
    return request('lead-capture', `${baseUrl}/api/v1/lead/public-capture`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        organizationId, name: 'Phase 7 Load Probe', phone: `+88017${suffix}`, privacyConsent: true, policyVersion: 'phase7-load',
      }),
    })
  })
}


for (let index = 0; index < jobs.length; index += concurrency) {
  await Promise.all(jobs.slice(index, index + concurrency).map((job) => job()))
}

const thresholds = {
  'public-property-search': Number(process.env.LOAD_P95_PUBLIC_MS || 100),
  'tenant-dashboard': Number(process.env.LOAD_P95_TENANT_MS || 300),
  'lead-capture': Number(process.env.LOAD_P95_WRITE_MS || 500),
}
const maxErrorRate = Number(process.env.LOAD_MAX_ERROR_RATE || 0.005)
let failed = false
for (const name of new Set(results.map((item) => item.name))) {
  const rows = results.filter((item) => item.name === name)
  const p95 = percentile(rows.map((item) => item.ms), 0.95)
  const errorRate = rows.filter((item) => !item.ok).length / rows.length
  console.log(`${name}: count=${rows.length} p95=${p95.toFixed(1)}ms errorRate=${(errorRate * 100).toFixed(2)}%`)
  if (p95 > thresholds[name] || errorRate > maxErrorRate) failed = true
}
if (!results.some((item) => item.name === 'tenant-dashboard')) {
  console.warn('tenant-dashboard load was skipped because no load-test credentials/token were provided')
}
if (failed) process.exit(1)
