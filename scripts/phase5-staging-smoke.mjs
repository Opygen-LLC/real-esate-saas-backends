const apiUrl = process.env.STAGING_API_URL?.replace(/\/$/, '')
const frontendUrl = process.env.STAGING_FRONTEND_URL?.replace(/\/$/, '')
const authToken = process.env.STAGING_AUTH_TOKEN
const metricsToken = process.env.METRICS_TOKEN
const tenantIdentifier = process.env.STAGING_TENANT_IDENTIFIER
const organizationId = process.env.STAGING_ORGANIZATION_ID
const revalidateSecret = process.env.NEXT_REVALIDATE_SECRET

for (const [name, value] of Object.entries({ STAGING_API_URL: apiUrl, STAGING_FRONTEND_URL: frontendUrl, STAGING_AUTH_TOKEN: authToken, METRICS_TOKEN: metricsToken, STAGING_TENANT_IDENTIFIER: tenantIdentifier, STAGING_ORGANIZATION_ID: organizationId, NEXT_REVALIDATE_SECRET: revalidateSecret })) {
  if (!value) throw new Error(`${name} is required for the Phase 5 staging smoke gate`)
}

const request = async (url, init = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const expectStatus = async (label, url, allowed, init = {}) => {
  const response = await request(url, init)
  if (!allowed.includes(response.status)) {
    const body = await response.text().catch(() => '')
    throw new Error(`${label} returned HTTP ${response.status}: ${body.slice(0, 500)}`)
  }
  return response
}

const metricSnapshot = async () => {
  const response = await expectStatus('metrics', `${apiUrl}/metrics`, [200], {
    headers: { authorization: `Bearer ${metricsToken}` },
  })
  return response.text()
}

const metricSum = (text, name, predicate = () => true) => text
  .split('\n')
  .filter((line) => line.startsWith(`${name}{`) || line.startsWith(`${name} `))
  .filter(predicate)
  .reduce((sum, line) => sum + Number(line.trim().split(/\s+/).at(-1) || 0), 0)

const badSnapshot = (text) => ({
  http5xx: metricSum(text, 'http_requests_total', (line) => /status="5\d\d"/.test(line)),
  crmFallback: metricSum(text, 'crm_read_model_fallback_total'),
  viewingInternalFailure: metricSum(text, 'viewing_update_internal_failures_total'),
  domainEventFailure: metricSum(text, 'domain_event_failures_total'),
  revalidationFailure: metricSum(text, 'next_revalidation_failures_total'),
  quotaTransactionFailure: metricSum(text, 'team_quota_transaction_failures_total'),
})

const delta = (after, before) => Object.fromEntries(Object.keys(after).map((key) => [key, Math.max(0, after[key] - before[key])]))

const baseline = badSnapshot(await metricSnapshot())
const authHeaders = { authorization: `Bearer ${authToken}`, accept: 'application/json' }

await expectStatus('api health', `${apiUrl}/health`, [200])
await expectStatus('api readiness', `${apiUrl}/ready`, [200])
await expectStatus('authenticated session', `${apiUrl}/api/v1/auth/session`, [200], { headers: authHeaders })
await expectStatus('lead CRM page', `${apiUrl}/api/v1/lead?page=1&limit=5&scope=team`, [200], { headers: authHeaders })
await expectStatus('website submissions', `${apiUrl}/api/v1/website-submissions?page=1&limit=5`, [200], { headers: authHeaders })
await expectStatus('viewings', `${apiUrl}/api/v1/viewing?page=1&limit=5`, [200], { headers: authHeaders })
await expectStatus('frontend health', `${frontendUrl}/healthz`, [200])
await expectStatus('tenant portal', `${frontendUrl}/portal/${encodeURIComponent(tenantIdentifier)}`, [200])
await expectStatus('tenant favicon route', `${frontendUrl}/portal/${encodeURIComponent(tenantIdentifier)}/favicon.ico`, [200, 301, 302, 307, 308], { redirect: 'manual' })
await expectStatus('Next revalidation', `${frontendUrl}/api/revalidate`, [200], {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-revalidate-secret': revalidateSecret },
  body: JSON.stringify({ organizationId, tenantIdentifiers: [tenantIdentifier], eventType: 'organization.branding_updated' }),
})

await new Promise((resolve) => setTimeout(resolve, 500))
const after = badSnapshot(await metricSnapshot())
const newFailures = delta(after, baseline)
const offenders = Object.entries(newFailures).filter(([, value]) => value > 0)
if (offenders.length) throw new Error(`Phase 5 staging smoke produced failure metrics: ${JSON.stringify(newFailures)}`)

console.log('Phase 5 staging smoke passed with zero new 5xx, CRM fallback, viewing internal, domain-event, revalidation, or quota transaction failures.')
