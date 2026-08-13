import ApiError from '../errors/ApiError'
import { Metrics } from './metrics'
import { RequestContext } from './requestContext'

type CircuitState = { failures: number; openUntil: number; halfOpen: boolean }
const circuits = new Map<string, CircuitState>()

export type FetchPolicy = {
  timeoutMs?: number
  failureThreshold?: number
  resetAfterMs?: number
  expectedStatuses?: number[]
}

const stateFor = (service: string): CircuitState => {
  const existing = circuits.get(service)
  if (existing) return existing
  const created = { failures: 0, openUntil: 0, halfOpen: false }
  circuits.set(service, created)
  return created
}

const fetchWithPolicy = async (service: string, url: string, init: RequestInit = {}, policy: FetchPolicy = {}): Promise<Response> => {
  const state = stateFor(service)
  const now = Date.now()
  if (state.openUntil > now) throw new ApiError(503, `${service} is temporarily unavailable`)
  if (state.openUntil && state.openUntil <= now) state.halfOpen = true

  const timeoutMs = Math.max(500, policy.timeoutMs || 10000)
  const failureThreshold = Math.max(2, policy.failureThreshold || 5)
  const resetAfterMs = Math.max(5000, policy.resetAfterMs || 30000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = performance.now()

  try {
    const headers = new Headers(init.headers || {})
    if (!headers.has('traceparent')) headers.set('traceparent', RequestContext.childTraceparent())
    const response = await fetch(url, { ...init, headers, signal: controller.signal })
    const expected = policy.expectedStatuses
    const failed = expected ? !expected.includes(response.status) : response.status >= 500 || response.status === 429
    if (failed) {
      state.failures += 1
      if (state.failures >= failureThreshold) state.openUntil = Date.now() + resetAfterMs
      Metrics.setGauge('external_circuit_open', state.openUntil > Date.now() ? 1 : 0, { service })
      Metrics.observeExternal({ service, outcome: `http_${response.status}`, durationMs: performance.now() - started })
    } else {
      state.failures = 0; state.openUntil = 0; state.halfOpen = false
      Metrics.setGauge('external_circuit_open', 0, { service })
      Metrics.observeExternal({ service, outcome: 'ok', durationMs: performance.now() - started })
    }
    return response
  } catch (error) {
    state.failures += 1
    if (state.failures >= failureThreshold || state.halfOpen) state.openUntil = Date.now() + resetAfterMs
    state.halfOpen = false
    Metrics.setGauge('external_circuit_open', state.openUntil > Date.now() ? 1 : 0, { service })
    Metrics.observeExternal({ service, outcome: (error as Error)?.name === 'AbortError' ? 'timeout' : 'network_error', durationMs: performance.now() - started })
    if ((error as Error)?.name === 'AbortError') throw new ApiError(504, `${service} request timed out`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export const Resilience = {
  fetch: fetchWithPolicy,
  status: () => [...circuits.entries()].map(([service, state]) => ({ service, failures: state.failures, openUntil: state.openUntil || null })),
}
