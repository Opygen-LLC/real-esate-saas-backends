import { createHash } from 'crypto'
import type { NextFunction, Request, Response } from 'express'
import config from '../../config'
import ApiError from '../../errors/ApiError'
import { logger } from '../../shared/logger'
import { RedisClient } from '../../shared/redisClient'
import { clientNetwork } from '../helpers/clientNetwork'

type RateRule = {
  name: string
  windowMs: number
  max: number
  key: (req: Request) => string | undefined | null
}

type RateLimitOptions = {
  name: string
  rules: RateRule[]
  message: string
  code?: string
}

type CounterResult = { count: number; ttlMs: number }

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`

const memoryCounters = new Map<string, { count: number; resetAt: number }>()

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32)
const keyPart = (value: unknown) => sha256(String(value || '').trim().toLowerCase())
const requestNetwork = (req: Request) => clientNetwork(req.ip || req.socket.remoteAddress || '')
const requestUserId = (req: Request) => String((req.user as any)?._id || (req.user as any)?.id || '').trim()
const requestTenantId = (req: Request) => String(req.tenant?.organizationId || (req.user as any)?.organizationId || '').trim()
const requestIdentifier = (req: Request) => {
  const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {}
  const raw = body.email || body.phoneNumber || body.phone || body.username || body.registrationContinuationToken || body.resetToken
  return raw ? keyPart(raw) : ''
}
const requestRefreshToken = (req: Request) => {
  const token = req.cookies?.[config.security.refresh_cookie_name]
  return typeof token === 'string' && token ? keyPart(token) : ''
}

const redisKey = (namespace: string, ruleName: string, identity: string) =>
  RedisClient.key('rate-limit', `${namespace}:${ruleName}:${sha256(identity)}`)

const consumeMemory = (key: string, windowMs: number): CounterResult => {
  const now = Date.now()
  const current = memoryCounters.get(key)
  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs
    memoryCounters.set(key, { count: 1, resetAt })
    return { count: 1, ttlMs: windowMs }
  }
  current.count += 1
  return { count: current.count, ttlMs: Math.max(1, current.resetAt - now) }
}

const consume = async (namespace: string, rule: RateRule, identity: string): Promise<CounterResult> => {
  const key = redisKey(namespace, rule.name, identity)
  if (!config.redis.enabled) {
    if (config.isProduction) throw new ApiError(503, 'Abuse protection is temporarily unavailable', '', 'RATE_LIMIT_UNAVAILABLE')
    return consumeMemory(key, rule.windowMs)
  }

  try {
    const result = await RedisClient.command(['EVAL', RATE_LIMIT_SCRIPT, 1, key, rule.windowMs])
    if (!Array.isArray(result) || result.length < 2) throw new Error('Invalid Redis rate-limit response')
    const count = Number(result[0])
    const ttlMs = Number(result[1])
    if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) throw new Error('Invalid Redis rate-limit counter')
    return { count, ttlMs: Math.max(1, ttlMs) }
  } catch (error) {
    logger.error('rate_limit_store_unavailable', {
      event: 'rate_limit_store_unavailable',
      namespace,
      rule: rule.name,
      error: error instanceof Error ? error.message : String(error),
    })
    if (config.isProduction) throw new ApiError(503, 'Abuse protection is temporarily unavailable', '', 'RATE_LIMIT_UNAVAILABLE')
    return consumeMemory(key, rule.windowMs)
  }
}

export const distributedRateLimit = (options: RateLimitOptions) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    let tightestRemaining = Number.POSITIVE_INFINITY
    let longestRetrySeconds = 0
    let exposedLimit = 0

    for (const rule of options.rules) {
      const identity = rule.key(req)
      if (!identity) continue
      const result = await consume(options.name, rule, identity)
      const remaining = Math.max(0, rule.max - result.count)
      const retrySeconds = Math.max(1, Math.ceil(result.ttlMs / 1000))
      tightestRemaining = Math.min(tightestRemaining, remaining)
      longestRetrySeconds = Math.max(longestRetrySeconds, retrySeconds)
      exposedLimit = exposedLimit ? Math.min(exposedLimit, rule.max) : rule.max

      if (result.count > rule.max) {
        res.setHeader('Retry-After', String(retrySeconds))
        res.setHeader('RateLimit-Limit', String(rule.max))
        res.setHeader('RateLimit-Remaining', '0')
        res.setHeader('RateLimit-Reset', String(retrySeconds))
        res.setHeader('Cache-Control', 'no-store')
        logger.warn('rate_limit_exceeded', {
          event: 'rate_limit_exceeded',
          limiter: options.name,
          rule: rule.name,
          requestId: req.requestId,
          route: req.originalUrl.split('?')[0],
          network: requestNetwork(req),
          organizationId: requestTenantId(req) || undefined,
          userId: requestUserId(req) || undefined,
        })
        throw new ApiError(429, options.message, '', options.code || 'RATE_LIMITED')
      }
    }

    if (Number.isFinite(tightestRemaining) && exposedLimit) {
      res.setHeader('RateLimit-Limit', String(exposedLimit))
      res.setHeader('RateLimit-Remaining', String(tightestRemaining))
      res.setHeader('RateLimit-Reset', String(longestRetrySeconds))
    }
    next()
  } catch (error) {
    next(error)
  }
}

const networkRule = (name: string, max: number, windowMs: number): RateRule => ({
  name,
  max,
  windowMs,
  key: (req) => `network:${requestNetwork(req)}`,
})
const identifierRule = (name: string, max: number, windowMs: number): RateRule => ({
  name,
  max,
  windowMs,
  key: (req) => requestIdentifier(req) ? `identity:${requestIdentifier(req)}` : undefined,
})
const pairRule = (name: string, max: number, windowMs: number): RateRule => ({
  name,
  max,
  windowMs,
  key: (req) => requestIdentifier(req) ? `pair:${requestNetwork(req)}:${requestIdentifier(req)}` : undefined,
})
const userRule = (name: string, max: number, windowMs: number): RateRule => ({
  name,
  max,
  windowMs,
  key: (req) => requestUserId(req) ? `user:${requestUserId(req)}` : undefined,
})
const tenantRule = (name: string, max: number, windowMs: number): RateRule => ({
  name,
  max,
  windowMs,
  key: (req) => requestTenantId(req) ? `tenant:${requestTenantId(req)}` : undefined,
})

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export const loginRateLimiter = distributedRateLimit({
  name: 'auth-login',
  message: 'Too many sign-in attempts. Please try again later.',
  code: 'AUTH_RATE_LIMITED',
  rules: [networkRule('network', 60, 15 * MINUTE), identifierRule('identity', 12, 15 * MINUTE), pairRule('network-identity', 8, 15 * MINUTE)],
})

export const registrationRateLimiter = distributedRateLimit({
  name: 'auth-registration',
  message: 'Too many registration attempts. Please try again later.',
  code: 'REGISTRATION_RATE_LIMITED',
  rules: [networkRule('network', 12, HOUR), identifierRule('identity', 4, HOUR)],
})

export const otpSendRateLimiter = distributedRateLimit({
  name: 'auth-otp-send',
  message: 'Too many verification-code requests. Please wait before trying again.',
  code: 'OTP_THROTTLED',
  rules: [networkRule('network', 20, 15 * MINUTE), identifierRule('identity', 4, 15 * MINUTE), pairRule('network-identity', 4, 15 * MINUTE)],
})

export const otpVerifyRateLimiter = distributedRateLimit({
  name: 'auth-otp-verify',
  message: 'Too many verification attempts. Please try again later.',
  code: 'OTP_VERIFY_RATE_LIMITED',
  rules: [networkRule('network', 40, 15 * MINUTE), identifierRule('identity', 10, 15 * MINUTE), pairRule('network-identity', 8, 15 * MINUTE)],
})

export const passwordResetRequestRateLimiter = distributedRateLimit({
  name: 'auth-password-reset-request',
  message: 'Too many password reset requests. Please try again later.',
  code: 'PASSWORD_RESET_RATE_LIMITED',
  rules: [networkRule('network', 15, HOUR), identifierRule('identity', 4, HOUR), pairRule('network-identity', 3, HOUR)],
})

export const passwordResetVerifyRateLimiter = distributedRateLimit({
  name: 'auth-password-reset-verify',
  message: 'Too many password reset verification attempts. Please try again later.',
  code: 'PASSWORD_RESET_RATE_LIMITED',
  rules: [networkRule('network', 30, 15 * MINUTE), identifierRule('identity', 8, 15 * MINUTE), pairRule('network-identity', 6, 15 * MINUTE)],
})

export const passwordResetCompleteRateLimiter = distributedRateLimit({
  name: 'auth-password-reset-complete',
  message: 'Too many password reset attempts. Please try again later.',
  code: 'PASSWORD_RESET_RATE_LIMITED',
  rules: [networkRule('network', 20, 15 * MINUTE), identifierRule('token', 5, 15 * MINUTE)],
})

export const registrationStatusRateLimiter = distributedRateLimit({
  name: 'auth-registration-status',
  message: 'Too many registration status checks. Please wait a moment and try again.',
  rules: [networkRule('network', 60, 5 * MINUTE), identifierRule('continuation', 20, 5 * MINUTE)],
})

export const refreshRateLimiter = distributedRateLimit({
  name: 'auth-refresh',
  message: 'Too many session refresh attempts.',
  rules: [
    networkRule('network', 120, 5 * MINUTE),
    { name: 'session', max: 30, windowMs: 5 * MINUTE, key: (req) => requestRefreshToken(req) ? `session:${requestRefreshToken(req)}` : `network:${requestNetwork(req)}` },
  ],
})

export const publicLeadRateLimiter = distributedRateLimit({
  name: 'public-form',
  message: 'Too many form submissions. Please try again later.',
  rules: [networkRule('network', 15, 15 * MINUTE), identifierRule('identity', 8, 15 * MINUTE), pairRule('network-identity', 6, 15 * MINUTE)],
})

export const generalApiRateLimiter = distributedRateLimit({
  name: 'public-read',
  message: 'Too many requests. Please try again later.',
  rules: [networkRule('network', 180, 15 * MINUTE)],
})

export const publicEventRateLimiter = distributedRateLimit({
  name: 'public-event',
  message: 'Too many event requests. Please try again later.',
  rules: [networkRule('network', 180, MINUTE)],
})

export const uploadRateLimiter = distributedRateLimit({
  name: 'upload',
  message: 'Too many uploads. Please try again in a few minutes.',
  rules: [networkRule('network', 120, 15 * MINUTE), userRule('user', 45, 15 * MINUTE), tenantRule('tenant', 180, 15 * MINUTE)],
})

export const uploadPresignRateLimiter = distributedRateLimit({
  name: 'upload-presign',
  message: 'Too many upload preparations. Please try again shortly.',
  rules: [networkRule('network', 180, 15 * MINUTE), userRule('user', 90, 15 * MINUTE), tenantRule('tenant', 300, 15 * MINUTE)],
})

export const leadImportRateLimiter = distributedRateLimit({
  name: 'lead-import',
  message: 'Too many lead import requests. Please try again in a few minutes.',
  rules: [userRule('user', 12, 15 * MINUTE), tenantRule('tenant', 30, 15 * MINUTE)],
})

export const propertyImportRateLimiter = distributedRateLimit({
  name: 'property-import',
  message: 'Too many property import requests. Please try again in a few minutes.',
  rules: [userRule('user', 12, 15 * MINUTE), tenantRule('tenant', 30, 15 * MINUTE)],
})

export const searchRateLimiter = distributedRateLimit({
  name: 'search',
  message: 'Too many search requests. Please try again shortly.',
  rules: [networkRule('network', 240, 5 * MINUTE), userRule('user', 120, 5 * MINUTE), tenantRule('tenant', 360, 5 * MINUTE)],
})

export const reportRateLimiter = distributedRateLimit({
  name: 'report',
  message: 'Too many report requests. Please try again shortly.',
  rules: [userRule('user', 30, 15 * MINUTE), tenantRule('tenant', 90, 15 * MINUTE)],
})

export const websiteMutationRateLimiter = distributedRateLimit({
  name: 'website-mutation',
  message: 'Too many website generation or publish requests. Please try again shortly.',
  rules: [userRule('user', 30, HOUR), tenantRule('tenant', 120, HOUR)],
})

export const exportRateLimiter = distributedRateLimit({
  name: 'export',
  message: 'Too many export requests. Please try again later.',
  rules: [userRule('user', 12, 15 * MINUTE), tenantRule('tenant', 40, 15 * MINUTE)],
})

export const adminNetworkRateLimiter = distributedRateLimit({
  name: 'admin-network',
  message: 'Too many administrator requests. Please try again shortly.',
  rules: [networkRule('network', 400, 15 * MINUTE)],
})

export const adminOperationRateLimiter = distributedRateLimit({
  name: 'admin-operation',
  message: 'Too many administrator requests. Please try again shortly.',
  rules: [userRule('user', 180, 15 * MINUTE)],
})

export const outboundEmailRateLimiter = distributedRateLimit({
  name: 'outbound-email',
  message: 'Too many email operations. Please try again later.',
  rules: [userRule('user', 20, HOUR), tenantRule('tenant', 100, HOUR)],
})

export const outboundSmsRateLimiter = distributedRateLimit({
  name: 'outbound-sms',
  message: 'Too many SMS requests. Please try again later.',
  rules: [userRule('user', 60, HOUR), tenantRule('tenant', 300, HOUR)],
})

export const outboundWhatsAppRateLimiter = distributedRateLimit({
  name: 'outbound-whatsapp',
  message: 'Too many WhatsApp message requests. Please try again later.',
  rules: [userRule('user', 60, HOUR), tenantRule('tenant', 300, HOUR)],
})

export const webhookRateLimiter = distributedRateLimit({
  name: 'provider-webhook',
  message: 'Too many webhook requests.',
  rules: [networkRule('network', 1200, MINUTE)],
})

// Backward-compatible alias retained for code paths that have not yet split
// registration from sign-in. New routes should use the specific limiter above.
export const authRateLimiter = loginRateLimiter
