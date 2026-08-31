import { performance } from 'perf_hooks'
import { emitProductionEvent } from '../../shared/productionEvents'

type MeasureKind = 'db' | 'redis'

const slowMs = Math.max(10, Number(process.env.QUERY_PROFILE_SLOW_MS || 100))
const sampleRate = Math.max(0, Math.min(1, Number(process.env.QUERY_PROFILE_SAMPLE_RATE || 0.05)))
const logAll = ['1', 'true', 'yes'].includes(String(process.env.QUERY_PROFILE_ALL || '').toLowerCase())

export const createQueryProfile = (route: string, organizationId: string) => {
  const startedAt = performance.now()
  let dbMs = 0
  let redisMs = 0
  let queryCount = 0

  const measure = async <T>(kind: MeasureKind, work: () => PromiseLike<T>, count = 1): Promise<T> => {
    const started = performance.now()
    try {
      return await work()
    } finally {
      const elapsed = performance.now() - started
      if (kind === 'db') {
        dbMs += elapsed
        queryCount += Math.max(0, Math.trunc(count))
      } else redisMs += elapsed
    }
  }

  const finish = (resultCount: number, extra: Record<string, unknown> = {}) => {
    const durationMs = performance.now() - startedAt
    if (!logAll && durationMs < slowMs && Math.random() >= sampleRate) return
    emitProductionEvent('query_performance', {
      route,
      organizationId,
      durationMs: Number(durationMs.toFixed(1)),
      dbMs: Number(dbMs.toFixed(1)),
      redisMs: Number(redisMs.toFixed(1)),
      queryCount,
      resultCount: Math.max(0, Math.trunc(resultCount)),
      ...extra,
    }, durationMs >= slowMs ? 'warn' : 'info')
  }

  return {
    db: <T>(work: () => PromiseLike<T>, count = 1) => measure('db', work, count),
    redis: <T>(work: () => PromiseLike<T>) => measure('redis', work, 0),
    finish,
  }
}
