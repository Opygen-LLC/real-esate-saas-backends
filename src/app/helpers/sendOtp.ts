import config from '../../config'
import ApiError from '../../errors/ApiError'
import { logger } from '../../shared/logger'

export interface SmsProvider { send(phoneNumber: string, message: string): Promise<void> }

class DevelopmentSmsProvider implements SmsProvider {
  async send(phoneNumber: string, message: string): Promise<void> {
    logger.info(`[SMS_DEV_MODE] ${phoneNumber}: ${message}`)
  }
}

class BangladeshHttpSmsProvider implements SmsProvider {
  async send(phoneNumber: string, message: string): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.sms.timeout_ms)
    try {
      const response = await fetch(config.sms.api_url, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.sms.api_token}` },
        body: JSON.stringify({ to: phoneNumber, senderId: config.sms.sender_id, message }),
      })
      if (!response.ok) throw new Error(`SMS provider returned ${response.status}`)
    } catch (error) {
      logger.error('SMS delivery failed', { error: error instanceof Error ? error.message : 'unknown' })
      throw new ApiError(502, 'Verification message could not be delivered')
    } finally { clearTimeout(timer) }
  }
}

export const smsProvider: SmsProvider = config.sms.development_mode
  ? new DevelopmentSmsProvider()
  : new BangladeshHttpSmsProvider()

export const sendSms = (phoneNumber: string, message: string): Promise<void> => smsProvider.send(phoneNumber, message)
export default (phoneNumber: string, otp: string): Promise<void> => sendSms(phoneNumber, `Your verification code is ${otp}. It expires in 5 minutes.`)
