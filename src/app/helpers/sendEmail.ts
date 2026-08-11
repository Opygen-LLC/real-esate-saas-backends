import nodemailer from 'nodemailer'
import config from '../../config'
import { logger } from '../../shared/logger'

const sendEmail = async (to: string, subject: string, html: string): Promise<boolean> => {
  try {
    if (!config.app_email || !config.app_password) {
      logger.info(`[Email Service Simulation] Subject: "${subject}" to: ${to}`)
      return true
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.app_email,
        pass: config.app_password,
      },
    })

    await transporter.sendMail({
      from: `"Real Estate SaaS" <${config.app_email}>`,
      to,
      subject,
      html,
    })

    return true
  } catch (error) {
    logger.error('Failed to send email:', error)
    return false
  }
}

export default sendEmail
