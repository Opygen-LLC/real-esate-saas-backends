import { logger } from '../../shared/logger'

const sendOtp = async (phoneNumber: string, otp: string): Promise<boolean> => {
  logger.info(`[OTP Verification] Code: ${otp} sent to Phone: ${phoneNumber}`)
  return true
}

export default sendOtp
