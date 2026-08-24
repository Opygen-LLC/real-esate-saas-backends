import winston from 'winston'
import 'winston-daily-rotate-file'
import path from 'path'
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

const enrichAndScrub = winston.format((info) => {
  const context = RequestContext.current()
  info.message = scrubString(String(info.message || ''))
  info.event = scrubString(String(info.event || info.message || 'log'))
  info.severity = String(info.level || 'info').toUpperCase()
  info.service = String(info.service || 'real-estate-api')

  if (!info.requestId && context?.requestId) info.requestId = context.requestId
  if (!info.traceId && context?.traceId) info.traceId = context.traceId
  if (!info.organizationId && context?.organizationId) info.organizationId = context.organizationId
  if (!info.userId && context?.userId) info.userId = context.userId
  if (!info.paymentId && context?.paymentId) info.paymentId = context.paymentId

  for (const key of Object.keys(info)) {
    if (['level', 'timestamp', 'message', 'event', 'severity', 'service'].includes(key)) continue
    info[key] = sensitiveKey.test(key) ? '[redacted]' : scrub(info[key])
  }

  return info
})

// Readable local output keeps development convenient while production emits
// one JSON object per line so Google Cloud Logging can index fields directly.
const readableFormat = winston.format.printf(({ level, message, ...meta }) => {
  const context = RequestContext.current()
  const reqId = context?.requestId ? `[${context.requestId}] ` : meta.requestId ? `[${meta.requestId}] ` : ''

  if (message === 'http_request' && meta.method && meta.route) {
    const statusStr = meta.statusCode ? ` - ${meta.statusCode}` : ''
    const durationStr = meta.durationMs !== undefined ? ` - ${meta.durationMs}ms` : ''
    const codeStr = meta.errorCode ? ` - ${meta.errorCode}` : ''
    return `${level}: ${reqId}${meta.method} ${meta.route}${statusStr}${durationStr}${codeStr}`
  }

  let msg = scrubString(String(message || ''))
  const metaKeys = Object.keys(meta).filter((key) => !['timestamp', 'level', 'splat', 'requestId', 'event', 'severity', 'service'].includes(key))
  if (metaKeys.length > 0) {
    const cleanMeta: Record<string, unknown> = {}
    for (const key of metaKeys) cleanMeta[key] = sensitiveKey.test(key) ? '[redacted]' : scrub(meta[key])
    if (Object.keys(cleanMeta).length > 0) msg = `${msg} ${JSON.stringify(cleanMeta)}`
  }

  return `${level}: ${reqId}${msg}`
})

const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  enrichAndScrub(),
  winston.format.json(),
)

const developmentFormat = winston.format.combine(
  enrichAndScrub(),
  winston.format.colorize({ all: true }),
  readableFormat,
)

const consoleFormat = process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat
const transports: winston.transport[] = [
  new winston.transports.Console({ format: consoleFormat }),
]

if (process.env.NODE_ENV !== 'production' || process.env.LOG_TO_FILE === 'true') {
  transports.push(
    new winston.transports.DailyRotateFile({
      filename: path.join(process.cwd(), 'logs', 'server-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '7d',
      level: 'info',
      format: process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
    }),
  )
}

const baseLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'warn',
  transports,
})

export const logger = baseLogger
export const errorLogger = baseLogger
export { scrub as scrubLogValue }
export default logger
