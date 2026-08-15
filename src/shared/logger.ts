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

// Formatter for readable console & daily file logs
const customFormat = winston.format.printf(({ level, message, ...meta }) => {
  const context = RequestContext.current()
  const reqId = context?.requestId ? `[${context.requestId}] ` : meta.requestId ? `[${meta.requestId}] ` : ''

  // Special formatting for http_request logs
  if (message === 'http_request' && meta.method && meta.path) {
    const statusStr = meta.statusCode ? ` - ${meta.statusCode}` : ''
    const durationStr = meta.durationMs !== undefined ? ` - ${meta.durationMs}ms` : ''
    return `${level}: ${reqId}${meta.method} ${meta.path}${statusStr}${durationStr}`
  }

  let msg = scrubString(String(message || ''))
  const metaKeys = Object.keys(meta).filter((k) => !['timestamp', 'level', 'splat', 'requestId'].includes(k))
  if (metaKeys.length > 0) {
    // Exclude redundant http keys if present
    const cleanMeta: Record<string, unknown> = {}
    for (const key of metaKeys) {
      if (!['method', 'path', 'statusCode', 'durationMs'].includes(key)) {
        cleanMeta[key] = sensitiveKey.test(key) ? '[redacted]' : scrub(meta[key])
      }
    }
    if (Object.keys(cleanMeta).length > 0) {
      msg = `${msg} ${JSON.stringify(cleanMeta)}`
    }
  }

  return `${level}: ${reqId}${msg}`
})

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: process.env.NODE_ENV !== 'production' }),
      customFormat,
    ),
  }),
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
      format: customFormat,
    }),
  )
}

const baseLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports,
})


export const logger = baseLogger
export const errorLogger = baseLogger
export { scrub as scrubLogValue }
export default logger
