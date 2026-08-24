const metricsUrl = process.env.PRODUCTION_METRICS_URL?.trim()
const metricsToken = process.env.METRICS_TOKEN?.trim()
const durationMinutes = Math.max(1, Number(process.env.PHASE5_MONITOR_MINUTES || 10))
const intervalSeconds = Math.max(10, Number(process.env.PHASE5_MONITOR_INTERVAL_SECONDS || 30))
const maxNew5xx = Math.max(0, Number(process.env.PHASE5_MAX_NEW_5XX || 0))

if (!metricsUrl) throw new Error('PRODUCTION_METRICS_URL is required')
if (!metricsToken) throw new Error('METRICS_TOKEN is required')

const fetchMetrics = async () => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(metricsUrl, { headers: { authorization: `Bearer ${metricsToken}` }, signal: controller.signal })
    if (!response.ok) throw new Error(`Metrics endpoint returned HTTP ${response.status}`)
    return response.text()
  } finally {
    clearTimeout(timer)
  }
}

const metricSum = (text, name, predicate = () => true) => text
  .split('\n')
  .filter((line) => line.startsWith(`${name}{`) || line.startsWith(`${name} `))
  .filter(predicate)
  .reduce((sum, line) => sum + Number(line.trim().split(/\s+/).at(-1) || 0), 0)

const snapshot = (text) => ({
  http5xx: metricSum(text, 'http_requests_total', (line) => /status="5\d\d"/.test(line)),
  crmFallback: metricSum(text, 'crm_read_model_fallback_total'),
  viewingInternalFailure: metricSum(text, 'viewing_update_internal_failures_total'),
  domainEventFailure: metricSum(text, 'domain_event_failures_total'),
  revalidationFailure: metricSum(text, 'next_revalidation_failures_total'),
  quotaTransactionFailure: metricSum(text, 'team_quota_transaction_failures_total'),
})

const diff = (current, baseline) => Object.fromEntries(Object.keys(current).map((key) => [key, Math.max(0, current[key] - baseline[key])]))
const baseline = snapshot(await fetchMetrics())
const deadline = Date.now() + durationMinutes * 60_000
console.log(`Phase 5 production watch started for ${durationMinutes} minute(s). Baseline=${JSON.stringify(baseline)}`)

while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000))
  const current = snapshot(await fetchMetrics())
  const changes = diff(current, baseline)
  console.log(`[${new Date().toISOString()}] delta=${JSON.stringify(changes)}`)

  const releaseBlockers = {
    ...changes,
    http5xx: Math.max(0, changes.http5xx - maxNew5xx),
  }
  if (Object.values(releaseBlockers).some((value) => value > 0)) {
    throw new Error(`Phase 5 production watch detected a release blocker: ${JSON.stringify(changes)}`)
  }
}

console.log('Phase 5 production watch passed: no new repeating CRM aggregation, Viewing internal, revalidation, domain-event, quota transaction, or disallowed 5xx failures were observed.')
