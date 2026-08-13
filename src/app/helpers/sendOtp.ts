import config from '../../config'
import ApiError from '../../errors/ApiError'
import { logger } from '../../shared/logger'
import { Resilience } from '../../shared/resilience'

export interface SmsProvider { send(phoneNumber: string, message: string): Promise<void> }

const providerConfigured = (): boolean =>
  Boolean(config.sms.api_url && config.sms.api_token && config.sms.sender_id)

class DevelopmentSmsProvider implements SmsProvider {
  async send(phoneNumber: string, message: string): Promise<void> {
    // Never selected in production: config rejects SMS_DEV_MODE=true there.
    logger.warn(`[SMS_DEV_MODE] ${phoneNumber}: ${message}`)
  }
}

class UnconfiguredSmsProvider implements SmsProvider {
  async send(): Promise<void> {
    logger.error('SMS provider is not configured. Set SMS_API_URL, SMS_API_TOKEN and SMS_SENDER_ID.')
    throw new ApiError(503, 'Verification service is not configured')
  }
}

class BangladeshHttpSmsProvider implements SmsProvider {
  async send(phoneNumber: string, message: string): Promise<void> {
    try {
      const response = await Resilience.fetch('sms-verification', config.sms.api_url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.sms.api_token}` },
        body: JSON.stringify({ to: phoneNumber, senderId: config.sms.sender_id, message }),
      }, { timeoutMs: config.sms.timeout_ms })

      if (!response.ok) {
        logger.error('SMS provider rejected verification message', { providerStatus: response.status, phoneSuffix: phoneNumber.slice(-4) })
        throw new ApiError(502, 'Verification message could not be delivered')
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      logger.error('SMS verification delivery failed', { error, phoneSuffix: phoneNumber.slice(-4) })
      throw new ApiError(502, 'Verification message could not be delivered')
    }
  }
}

const createSmsProvider = (): SmsProvider => {
  if (config.sms.development_mode) return new DevelopmentSmsProvider()
  if (!providerConfigured()) return new UnconfiguredSmsProvider()
  return new BangladeshHttpSmsProvider()
}

export const smsProvider: SmsProvider = createSmsProvider()
export const sendSms = (phoneNumber: string, message: string): Promise<void> => smsProvider.send(phoneNumber, message)
export default (phoneNumber: string, otp: string): Promise<void> =>
  sendSms(phoneNumber, `Your verification code is ${otp}. It expires in 5 minutes.`)
