import { createHash } from 'crypto'
import config from '../../config'
import ApiError from '../../errors/ApiError'
import { logger } from '../../shared/logger'
import { RedisClient } from '../../shared/redisClient'

type BudgetKind = 'email' | 'sms' | 'whatsapp' | 'meta' | 'upload-bytes'

type DailyBudgetInput = {
  kind: BudgetKind
  scopeId: string
  units?: number
  scopeLimit: number
  globalLimit: number
}

const LUA_RESERVE_DAILY = `
local units = tonumber(ARGV[1])
local scopeLimit = tonumber(ARGV[2])
local globalLimit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local scopeCurrent = tonumber(redis.call('GET', KEYS[1]) or '0')
local globalCurrent = tonumber(redis.call('GET', KEYS[2]) or '0')
if scopeCurrent + units > scopeLimit then
  return {0, scopeCurrent, globalCurrent, 1}
end
if globalCurrent + units > globalLimit then
  return {0, scopeCurrent, globalCurrent, 2}
end
local scopeNext = redis.call('INCRBY', KEYS[1], units)
local globalNext = redis.call('INCRBY', KEYS[2], units)
if redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ttl) end
if redis.call('PTTL', KEYS[2]) < 0 then redis.call('PEXPIRE', KEYS[2], ttl) end
return {1, scopeNext, globalNext, 0}
`

const hashScope = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24)

const utcDay = (now = new Date()) => now.toISOString().slice(0, 10)
const millisecondsUntilTomorrowUtc = (now = new Date()) => {
  const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(60_000, tomorrow - now.getTime() + 5 * 60_000)
}

const asNumber = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const reserveDaily = async (input: DailyBudgetInput): Promise<void> => {
  const units = Math.max(1, Math.floor(Number(input.units || 1)))
  if (!config.redis.enabled) {
    if (config.isProduction) throw new ApiError(503, 'Usage protection is temporarily unavailable', '', 'USAGE_BUDGET_UNAVAILABLE')
    return
  }

  const day = utcDay()
  const scopeKey = RedisClient.key('budget', `${input.kind}:${day}:scope:${hashScope(input.scopeId)}`)
  const globalKey = RedisClient.key('budget', `${input.kind}:${day}:global`)
  try {
    const response = await RedisClient.command([
      'EVAL', LUA_RESERVE_DAILY, 2,
      scopeKey, globalKey,
      units, input.scopeLimit, input.globalLimit, millisecondsUntilTomorrowUtc(),
    ])
    if (!Array.isArray(response) || response.length < 4) throw new Error('Invalid Redis usage-budget response')
    if (asNumber(response[0]) === 1) return

    const reason = asNumber(response[3]) === 2 ? 'global' : 'scope'
    logger.warn('usage_budget_exceeded', {
      event: 'usage_budget_exceeded',
      kind: input.kind,
      scopeHash: hashScope(input.scopeId),
      reason,
      attemptedUnits: units,
      scopeUsed: asNumber(response[1]),
      globalUsed: asNumber(response[2]),
    })
    throw new ApiError(429, 'Daily usage limit reached. Please try again after the daily reset.', '', 'USAGE_BUDGET_EXCEEDED')
  } catch (error) {
    if (error instanceof ApiError) throw error
    logger.error('usage_budget_store_unavailable', {
      event: 'usage_budget_store_unavailable',
      kind: input.kind,
      error: error instanceof Error ? error.message : String(error),
    })
    if (config.isProduction) throw new ApiError(503, 'Usage protection is temporarily unavailable', '', 'USAGE_BUDGET_UNAVAILABLE')
  }
}

const reserveEmail = (scopeId: string, units = 1, scopeLimit = config.abuse.email_tenant_daily_limit) => reserveDaily({
  kind: 'email', scopeId, units,
  scopeLimit,
  globalLimit: config.abuse.email_global_daily_limit,
})

const reserveSms = (organizationId: string, units = 1) => reserveDaily({
  kind: 'sms', scopeId: organizationId, units,
  scopeLimit: config.abuse.sms_tenant_daily_limit,
  globalLimit: config.abuse.sms_global_daily_limit,
})

const reserveWhatsApp = (organizationId: string, units = 1) => reserveDaily({
  kind: 'whatsapp', scopeId: organizationId, units,
  scopeLimit: config.abuse.whatsapp_tenant_daily_limit,
  globalLimit: config.abuse.whatsapp_global_daily_limit,
})

const reserveMeta = (organizationId: string, units = 1) => reserveDaily({
  kind: 'meta', scopeId: organizationId, units,
  scopeLimit: config.abuse.meta_tenant_daily_limit,
  globalLimit: config.abuse.meta_global_daily_limit,
})

const reserveUploadBytes = (organizationId: string, bytes: number) => reserveDaily({
  kind: 'upload-bytes', scopeId: organizationId, units: bytes,
  scopeLimit: config.abuse.upload_tenant_daily_bytes,
  globalLimit: config.abuse.upload_global_daily_bytes,
})

export const UsageBudgetService = { reserveDaily, reserveEmail, reserveSms, reserveWhatsApp, reserveMeta, reserveUploadBytes }
