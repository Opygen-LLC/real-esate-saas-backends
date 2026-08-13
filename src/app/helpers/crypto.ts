import crypto from 'crypto'
import config from '../../config'

export const generateOtp = (): string => crypto.randomInt(100000, 1000000).toString()
export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url')
export const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex')
export const hashOtp = (challengeId: string, otp: string): string =>
  crypto.createHmac('sha256', config.security.otp_pepper).update(`${challengeId}:${otp}`).digest('hex')
export const safeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
