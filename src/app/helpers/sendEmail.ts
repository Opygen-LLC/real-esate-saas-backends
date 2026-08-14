import nodemailer from 'nodemailer'
import config from '../../config'
import { logger } from '../../shared/logger'

let transport: ReturnType<typeof nodemailer.createTransport> | null = null

const transporter = () => {
  if (transport) return transport
  if (!config.email.host || !config.email.user || !config.email.password) return null
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

const sendEmail = async (to: string, subject: string, html: string): Promise<boolean> => {
  try {
    const client = transporter()
    if (!client) {
      if (config.email.development_mode && !config.isProduction) {
        logger.info('[EMAIL_DEV_MODE] Email delivery simulated', { subject, recipientConfigured: Boolean(to) })
        return true
      }
      logger.error('SMTP provider is not configured')
      return false
    }
    await client.sendMail({ from: config.email.from, to, subject, html })
    return true
  } catch (error) {
    logger.error('Email delivery failed', { error })
    return false
  }
}

export default sendEmail
