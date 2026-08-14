import nodemailer from 'nodemailer'
import config from '../../config'
import { logger } from '../../shared/logger'

let transport: any = null
let lastHealthCheckAt = 0
let lastHealthResult = false

const transporter = () => {
  if (transport) return transport
  if (!config.email.host || !config.email.user || !config.email.password || !config.email.from) return null
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

const isRetryable = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; responseCode?: unknown }
  if (typeof value.responseCode === 'number' && value.responseCode >= 400 && value.responseCode < 500) return true
  return ['ECONNRESET', 'ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'EAI_AGAIN'].includes(String(value.code || ''))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const verifyEmailProvider = async (force = false): Promise<boolean> => {
  if (config.email.development_mode && !config.isProduction) return true
  const client = transporter()
  if (!client) return false

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
    logger.error('SMTP verification failed', errorMetadata(error))
    return false
  }
}

export const emailProviderStatus = () => ({
  configured: Boolean(config.email.host && config.email.user && config.email.password && config.email.from),
  healthy: lastHealthResult,
  lastCheckedAt: lastHealthCheckAt ? new Date(lastHealthCheckAt).toISOString() : null,
})

const sendEmail = async (to: string, subject: string, html: string): Promise<boolean> => {
  const client = transporter()
  if (!client) {
    if (config.email.development_mode && !config.isProduction) {
      logger.info('[EMAIL_DEV_MODE] Email delivery simulated (No real email sent to inbox). Set EMAIL_DEV_MODE=false and configure SMTP in .env for real emails.', { subject, recipient: to })
      return true
    }
    logger.error('SMTP provider is not configured')
    return false
  }

  for (let attempt = 1; attempt <= config.email.max_attempts; attempt += 1) {
    try {
      await client.sendMail({ from: config.email.from, to, subject, html })
      lastHealthResult = true
      lastHealthCheckAt = Date.now()
      return true
    } catch (error) {
      const retry = attempt < config.email.max_attempts && isRetryable(error)
      logger.error('Email delivery failed', { ...errorMetadata(error), attempt, retry })
      lastHealthResult = false
      lastHealthCheckAt = Date.now()
      if (!retry) return false
      await sleep(config.email.retry_delay_ms * attempt)
    }
  }

  return false
}

export default sendEmail
