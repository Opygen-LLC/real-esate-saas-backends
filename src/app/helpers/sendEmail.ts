import nodemailer from 'nodemailer'
import config from '../../config'
import { logger } from '../../shared/logger'

export type EmailDeliveryCode =
  | 'EMAIL_SENT'
  | 'EMAIL_SIMULATED'
  | 'SMTP_NOT_CONFIGURED'
  | 'SMTP_AUTH_FAILED'
  | 'SMTP_CONNECTION_FAILED'
  | 'SMTP_PROVIDER_REJECTED'

export type EmailDeliveryResult = {
  delivered: boolean
  simulated: boolean
  code: EmailDeliveryCode
  providerMessageId?: string
}

let transport: any = null
let lastHealthCheckAt = 0
let lastHealthResult = false
let lastDeliveryCode: EmailDeliveryCode | null = null

const isConfigured = () => Boolean(config.email.host && config.email.user && config.email.password && config.email.from)

const transporter = () => {
  if (transport) return transport
  if (!isConfigured()) return null
  transport = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    connectionTimeout: config.email.connection_timeout_ms,
    greetingTimeout: config.email.connection_timeout_ms,
    socketTimeout: config.email.socket_timeout_ms,
    auth: { user: config.email.user, pass: config.email.password },
  })
  return transport
}

const errorMetadata = (error: unknown) => {
  if (!error || typeof error !== 'object') return { message: String(error) }
  const value = error as { message?: unknown; code?: unknown; command?: unknown; responseCode?: unknown }
  return {
    message: typeof value.message === 'string' ? value.message : 'SMTP error',
    code: typeof value.code === 'string' ? value.code : undefined,
    command: typeof value.command === 'string' ? value.command : undefined,
    responseCode: typeof value.responseCode === 'number' ? value.responseCode : undefined,
  }
}

const classifyError = (error: unknown): EmailDeliveryCode => {
  if (!error || typeof error !== 'object') return 'SMTP_CONNECTION_FAILED'
  const value = error as { code?: unknown; responseCode?: unknown; command?: unknown }
  const code = String(value.code || '').toUpperCase()
  const command = String(value.command || '').toUpperCase()
  const responseCode = typeof value.responseCode === 'number' ? value.responseCode : 0
  if (code === 'EAUTH' || command === 'AUTH' || responseCode === 535 || responseCode === 534) return 'SMTP_AUTH_FAILED'
  if (responseCode >= 400) return 'SMTP_PROVIDER_REJECTED'
  if (['ECONNRESET', 'ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) return 'SMTP_CONNECTION_FAILED'
  return 'SMTP_CONNECTION_FAILED'
}

const isRetryable = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; responseCode?: unknown }
  if (typeof value.responseCode === 'number' && value.responseCode >= 400 && value.responseCode < 500) return true
  return ['ECONNRESET', 'ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNREFUSED', 'EAI_AGAIN'].includes(String(value.code || '').toUpperCase())
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const verifyEmailProvider = async (force = false): Promise<boolean> => {
  if (config.email.development_mode) {
    // Development mode is a deliberate simulator. It is healthy for local/test
    // readiness, but it never creates an SMTP transport or sends externally.
    lastHealthResult = !config.isProduction
    lastHealthCheckAt = Date.now()
    return lastHealthResult
  }

  const client = transporter()
  if (!client) {
    lastHealthResult = false
    lastHealthCheckAt = Date.now()
    lastDeliveryCode = 'SMTP_NOT_CONFIGURED'
    return false
  }

  const now = Date.now()
  if (!force && lastHealthCheckAt && now - lastHealthCheckAt < config.email.health_cache_ms) return lastHealthResult

  try {
    await client.verify()
    lastHealthResult = true
    lastHealthCheckAt = Date.now()
    return true
  } catch (error) {
    lastHealthResult = false
    lastHealthCheckAt = Date.now()
    lastDeliveryCode = classifyError(error)
    logger.error('SMTP verification failed', { ...errorMetadata(error), deliveryCode: lastDeliveryCode })
    return false
  }
}

export const emailProviderStatus = () => ({
  configured: isConfigured(),
  healthy: config.email.development_mode && !config.isProduction ? true : lastHealthResult,
  mode: config.email.development_mode ? 'simulated' as const : 'smtp' as const,
  lastDeliveryCode,
  lastCheckedAt: lastHealthCheckAt ? new Date(lastHealthCheckAt).toISOString() : null,
})

export const sendEmailDetailed = async (to: string, subject: string, html: string): Promise<EmailDeliveryResult> => {
  // This check MUST happen before transporter() so EMAIL_DEV_MODE can never
  // accidentally deliver real messages merely because SMTP is also configured.
  if (config.email.development_mode) {
    lastDeliveryCode = 'EMAIL_SIMULATED'
    lastHealthResult = !config.isProduction
    lastHealthCheckAt = Date.now()
    logger.info('Email delivery simulated', { deliveryCode: lastDeliveryCode, subject, recipient: to })
    return { delivered: true, simulated: true, code: lastDeliveryCode }
  }

  const client = transporter()
  if (!client) {
    lastDeliveryCode = 'SMTP_NOT_CONFIGURED'
    lastHealthResult = false
    lastHealthCheckAt = Date.now()
    logger.error('Email delivery unavailable', { deliveryCode: lastDeliveryCode })
    return { delivered: false, simulated: false, code: lastDeliveryCode }
  }

  for (let attempt = 1; attempt <= config.email.max_attempts; attempt += 1) {
    try {
      const info = await client.sendMail({ from: config.email.from, to, subject, html })
      lastDeliveryCode = 'EMAIL_SENT'
      lastHealthResult = true
      lastHealthCheckAt = Date.now()
      logger.info('Email delivered', { deliveryCode: lastDeliveryCode, subject, recipient: to })
      return { delivered: true, simulated: false, code: lastDeliveryCode, providerMessageId: info?.messageId }
    } catch (error) {
      const code = classifyError(error)
      const retry = attempt < config.email.max_attempts && isRetryable(error)
      lastDeliveryCode = code
      logger.error('Email delivery failed', { ...errorMetadata(error), deliveryCode: code, attempt, retry })
      lastHealthResult = false
      lastHealthCheckAt = Date.now()
      if (!retry) return { delivered: false, simulated: false, code }
      await sleep(config.email.retry_delay_ms * attempt)
    }
  }

  lastDeliveryCode = lastDeliveryCode || 'SMTP_CONNECTION_FAILED'
  return { delivered: false, simulated: false, code: lastDeliveryCode }
}

const sendEmail = async (to: string, subject: string, html: string): Promise<boolean> =>
  (await sendEmailDetailed(to, subject, html)).delivered

export default sendEmail
