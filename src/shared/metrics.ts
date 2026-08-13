type Labels = Record<string, string | number | boolean | undefined>

type Histogram = {
  count: number
  sum: number
  buckets: number[]
}

const MAX_SERIES = 1500
const HTTP_BUCKETS_MS = [25, 50, 100, 200, 300, 500, 1000, 2000, 5000]
const EXTERNAL_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000]
const counters = new Map<string, number>()
const histograms = new Map<string, Histogram>()
const gauges = new Map<string, number>()

const cleanLabel = (value: unknown): string => String(value ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\n/g, '\\n')
  .slice(0, 160)

const labelKey = (labels: Labels = {}): string => Object.entries(labels)
  .filter(([, value]) => value !== undefined)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, value]) => `${key}="${cleanLabel(value)}"`)
  .join(',')

const series = (name: string, labels: Labels = {}): string => {
  const rendered = labelKey(labels)
  return rendered ? `${name}{${rendered}}` : name
}

const boundedSet = <T>(map: Map<string, T>, key: string, value: T): void => {
  if (!map.has(key) && map.size >= MAX_SERIES) return
  map.set(key, value)
}

const inc = (name: string, labels: Labels = {}, amount = 1): void => {
  const key = series(name, labels)
  boundedSet(counters, key, (counters.get(key) || 0) + amount)
}

const setGauge = (name: string, value: number, labels: Labels = {}): void => {
  boundedSet(gauges, series(name, labels), Number.isFinite(value) ? value : 0)
}

const observe = (name: string, value: number, buckets: number[], labels: Labels = {}): void => {
  const key = series(name, labels)
  const current = histograms.get(key) || { count: 0, sum: 0, buckets: buckets.map(() => 0) }
  current.count += 1
  current.sum += value
  buckets.forEach((bucket, index) => { if (value <= bucket) current.buckets[index] += 1 })
  boundedSet(histograms, key, current)
}

const normalizeRoute = (path: string): string => (path || '/')
  .split('?')[0]
  .replace(/[0-9a-f]{24}/gi, ':id')
  .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
  .replace(/\b\d{4,}\b/g, ':n')
  .replace(/\/+/g, '/')
  .slice(0, 180)

const observeHttp = (input: { method: string; path: string; statusCode: number; durationMs: number }): void => {
  const labels = { method: input.method.toUpperCase(), route: normalizeRoute(input.path), status: String(input.statusCode) }
  inc('http_requests_total', labels)
  observe('http_request_duration_ms', input.durationMs, HTTP_BUCKETS_MS, labels)
}

const observeExternal = (input: { service: string; outcome: string; durationMs: number }): void => {
  const labels = { service: input.service, outcome: input.outcome }
  inc('external_requests_total', labels)
  observe('external_request_duration_ms', input.durationMs, EXTERNAL_BUCKETS_MS, labels)
}

const observeQueue = (type: string, outcome: string): void => inc('operations_jobs_total', { type, outcome })
const cache = (namespace: string, outcome: 'hit' | 'miss' | 'error'): void => inc('cache_operations_total', { namespace, outcome })

const render = (): string => {
  setGauge('process_uptime_seconds', process.uptime())
  setGauge('process_resident_memory_bytes', process.memoryUsage().rss)
  setGauge('process_heap_used_bytes', process.memoryUsage().heapUsed)
  setGauge('nodejs_active_handles', (process as any)._getActiveHandles?.().length || 0)

  const lines: string[] = []
  for (const [key, value] of counters) lines.push(`${key} ${value}`)
  for (const [key, value] of gauges) lines.push(`${key} ${value}`)
  for (const [key, histogram] of histograms) {
    const brace = key.indexOf('{')
    const name = brace === -1 ? key : key.slice(0, brace)
    const labels = brace === -1 ? '' : key.slice(brace + 1, -1)
    const buckets = name === 'http_request_duration_ms' ? HTTP_BUCKETS_MS : EXTERNAL_BUCKETS_MS
    buckets.forEach((bucket, index) => {
      const bucketLabels = labels ? `${labels},le="${bucket}"` : `le="${bucket}"`
      lines.push(`${name}_bucket{${bucketLabels}} ${histogram.buckets[index]}`)
    })
    const infLabels = labels ? `${labels},le="+Inf"` : 'le="+Inf"'
    lines.push(`${name}_bucket{${infLabels}} ${histogram.count}`)
    lines.push(`${name}_sum${labels ? `{${labels}}` : ''} ${histogram.sum}`)
    lines.push(`${name}_count${labels ? `{${labels}}` : ''} ${histogram.count}`)
  }
  return `${lines.join('\n')}\n`
}

export const Metrics = { inc, setGauge, observeHttp, observeExternal, observeQueue, cache, render, normalizeRoute }
