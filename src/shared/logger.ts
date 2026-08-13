import { createLogger, format, transports } from 'winston'
import { RequestContext } from './requestContext'

const sensitiveKey = /^(ip|ipAddress|clientIp)$|(?:authorization|cookie|password|secret|token|otp|access.?token|refresh.?token|payerAccount|nid|tin|bin)/i
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const phonePattern = /(?:\+?880|0)1[3-9]\d{8}\b/g
const jwtPattern = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g

const scrubString = (value: string): string => value
  .replace(emailPattern, '[redacted-email]')
  .replace(phonePattern, '[redacted-phone]')
  .replace(jwtPattern, '[redacted-token]')
  .slice(0, 12000)

const scrub = (value: unknown, depth = 0): unknown => {
  if (depth > 5) return '[truncated]'
  if (value instanceof Error) return { name: value.name, message: scrubString(value.message), stack: scrubString(value.stack || '') }
  if (typeof value === 'string') return scrubString(value)
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrub(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 80).map(([key, item]) => [key, sensitiveKey.test(key) ? '[redacted]' : scrub(item, depth + 1)]))
  }
  return value
}

const jsonLine = format.printf((info) => {
  const context = RequestContext.current()
  const payload: Record<string, unknown> = {
    timestamp: info.timestamp,
    level: info.level,
    service: 'real-estate-saas-api',
    message: scrubString(String(info.message || '')),
    ...(context ? {
      requestId: context.requestId,
      traceId: context.traceId,
      organizationId: context.organizationId,
      userId: context.userId,
      paymentId: context.paymentId,
    } : {}),
  }
  for (const [key, value] of Object.entries(info)) {
    if (['timestamp', 'level', 'message', 'splat'].includes(key)) continue
    payload[key] = sensitiveKey.test(key) ? '[redacted]' : scrub(value)
  }
  return JSON.stringify(payload)
})

const base = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), jsonLine),
  transports: [new transports.Console()],
})

export const logger = base
export const errorLogger = base
export { scrub as scrubLogValue }
