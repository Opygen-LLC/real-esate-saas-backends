const required = (name) => {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
const apiUrl = new URL(required('SECURITY_SMOKE_API_URL'))
const metricsToken = required('SECURITY_SMOKE_METRICS_TOKEN')
if (apiUrl.protocol !== 'https:' || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
  throw new Error('SECURITY_SMOKE_API_URL must be a clean https:// production/staging origin')
}
if (String(process.env.PROVIDER_BUDGETS_VERIFIED || '').toLowerCase() !== 'true') {
  throw new Error('PROVIDER_BUDGETS_VERIFIED=true is required after cloud/SMS/email/provider budget alerts are confirmed')
}
const maxBackupAgeHours = Math.max(1, Number(process.env.BACKUP_MAX_AGE_HOURS || 36))
const base = apiUrl.origin

const fetchText = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, { redirect: 'manual', ...init })
  const text = await response.text()
  return { response, text }
}
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const assertSecurityHeaders = (response, label) => {
  assert((response.headers.get('strict-transport-security') || '').includes('max-age='), `${label}: HSTS missing`)
  assert(response.headers.get('x-content-type-options') === 'nosniff', `${label}: nosniff missing`)
  assert((response.headers.get('referrer-policy') || '').length > 0, `${label}: Referrer-Policy missing`)
  assert(!response.headers.has('x-powered-by'), `${label}: x-powered-by must be disabled`)
}
const assertNoSecrets = (value, label) => {
  const patterns = [
    /mongodb(?:\+srv)?:\/\/[^\s"']+/i,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    /[?&](?:x-goog-signature|x-amz-signature|token|access_token|refresh_token|api_key|secret)=/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ]
  for (const pattern of patterns) assert(!pattern.test(value), `${label}: response appears to expose sensitive material`)
}

const health = await fetchText('/health')
assert(health.response.status === 200, `/health returned ${health.response.status}`)
assertSecurityHeaders(health.response, '/health')
assertNoSecrets(health.text, '/health')

const ready = await fetchText('/ready')
assert(ready.response.status === 200, `/ready returned ${ready.response.status}`)
assertSecurityHeaders(ready.response, '/ready')
assertNoSecrets(ready.text, '/ready')

const unauthAdmin = await fetchText('/api/v1/platform-admin/search')
assert(unauthAdmin.response.status === 401, `unauthenticated platform admin route must return 401, got ${unauthAdmin.response.status}`)
assertNoSecrets(unauthAdmin.text, 'unauthenticated admin response')

const evilOrigin = 'https://attacker.invalid'
const corsProbe = await fetchText('/api/v1/platform-admin/search', {
  method: 'OPTIONS',
  headers: { Origin: evilOrigin, 'Access-Control-Request-Method': 'GET' },
})
assert(corsProbe.response.headers.get('access-control-allow-origin') !== evilOrigin, 'private CORS reflected an untrusted origin')

const csrfProbe = await fetchText('/api/v1/organization/update', {
  method: 'PATCH',
  headers: { Origin: evilOrigin, 'Content-Type': 'application/json' },
  body: '{}',
})
assert(csrfProbe.response.status === 403, `cross-origin private mutation must fail with 403, got ${csrfProbe.response.status}`)

const metricsUnauth = await fetchText('/metrics')
assert(metricsUnauth.response.status === 401, `unauthenticated /metrics must return 401, got ${metricsUnauth.response.status}`)

const metrics = await fetchText('/metrics', { headers: { Authorization: `Bearer ${metricsToken}` } })
assert(metrics.response.status === 200, `authenticated /metrics returned ${metrics.response.status}`)
assertNoSecrets(metrics.text, '/metrics')
const metricValue = (name) => {
  const match = metrics.text.match(new RegExp(`^${name}\\s+(-?\\d+(?:\\.\\d+)?)$`, 'm'))
  return match ? Number(match[1]) : Number.NaN
}
const restoreVerified = metricValue('database_backup_restore_verified')
const backupAgeSeconds = metricValue('database_backup_age_seconds')
assert(restoreVerified === 1, 'latest database backup has not passed restore verification')
assert(Number.isFinite(backupAgeSeconds) && backupAgeSeconds >= 0, 'database backup freshness metric is unavailable')
assert(backupAgeSeconds <= maxBackupAgeHours * 3600, `database backup is stale (${Math.round(backupAgeSeconds / 3600)}h old)`)
for (const dep of ['mongo', 'mongo_transactions', 'redis', 'object_storage', 'malware_scanner']) {
  const match = metrics.text.match(new RegExp(`^dependency_healthy\\{dependency="${dep}"\\}\\s+([01])$`, 'm'))
  assert(match && Number(match[1]) === 1, `production dependency ${dep} is not healthy`)
}

const httpUrl = new URL(base)
httpUrl.protocol = 'http:'
const httpResponse = await fetch(httpUrl, { redirect: 'manual' }).catch((error) => { throw new Error(`HTTP redirect probe failed: ${error.message}`) })
assert([301, 302, 307, 308].includes(httpResponse.status), `HTTP endpoint must redirect to HTTPS, got ${httpResponse.status}`)
const location = httpResponse.headers.get('location') || ''
assert(location.startsWith('https://'), `HTTP redirect did not point to HTTPS (${location || 'missing Location'})`)

console.log(`Production security smoke passed for ${base}; backup age ${Math.round(backupAgeSeconds / 60)} minutes.`)
