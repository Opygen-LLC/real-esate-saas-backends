import dotenv from 'dotenv'
import path from 'path'
import { z } from 'zod'

dotenv.config({
  path: path.join(process.cwd(), '.env'),
})

const isProduction = process.env.NODE_ENV === 'production'
const requiredInProduction = (name: string, minimum = 1): string => {
  const value = process.env[name]?.trim()
  if (isProduction && (!value || value.length < minimum)) {
    throw new Error(`Missing or insecure production configuration: ${name}`)
  }
  return value || ''
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean)

if (isProduction) {
  const requiredUrls = ['DATABASE_URL', 'PUBLIC_API_URL', 'CLIENT_URL', 'ALLOWED_ORIGINS', 'COOKIE_DOMAIN']
  requiredUrls.forEach((name) => requiredInProduction(name))
  requiredInProduction('JWT_SECRET', 32)
  requiredInProduction('JWT_REFRESH_SECRET', 32)
  requiredInProduction('OTP_PEPPER', 32)
  requiredInProduction('CRON_SIGNING_SECRET', 32)
  if (process.env.SMS_DEV_MODE === 'true') throw new Error('SMS_DEV_MODE must be false in production')
  const requiredSms = ['SMS_API_URL', 'SMS_API_TOKEN', 'SMS_SENDER_ID']
  requiredSms.forEach((name) => requiredInProduction(name))
}

for (const origin of allowedOrigins) {
  if (!z.string().url().safeParse(origin).success) throw new Error(`Invalid ALLOWED_ORIGINS entry: ${origin}`)
}

export default {
  env: process.env.NODE_ENV || 'development',
  isProduction,
  port: Number(process.env.PORT || 5000),
  public_api_url: process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 5000}`,
  client_url: process.env.CLIENT_URL || 'http://localhost:3000',
  allowed_origins: allowedOrigins,
  cookie_domain: process.env.COOKIE_DOMAIN || undefined,
  database_string: process.env.DATABASE_URL || 'mongodb://127.0.0.1:27017/real-estate-saas',
  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS || '12',
  app_email: process.env.APP_EMAIL,
  app_password: process.env.APP_PASSWORD,
  jwt: {
    secret: process.env.JWT_SECRET || 'development-only-access-secret-change-me',
    refresh_secret: process.env.JWT_REFRESH_SECRET || 'development-only-refresh-secret-change-me',
    expires_in: process.env.JWT_EXPIRES_IN || '15m',
    refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  security: {
    otp_pepper: process.env.OTP_PEPPER || 'development-only-otp-pepper-change-me',
    cron_signing_secret: process.env.CRON_SIGNING_SECRET || 'development-only-cron-secret-change-me',
    csrf_cookie_name: 'csrfToken',
    access_cookie_name: 'accessToken',
    refresh_cookie_name: 'refreshToken',
  },
  sms: {
    development_mode: process.env.SMS_DEV_MODE === 'true',
    api_url: process.env.SMS_API_URL || '',
    api_token: process.env.SMS_API_TOKEN || '',
    sender_id: process.env.SMS_SENDER_ID || '',
    timeout_ms: Number(process.env.SMS_TIMEOUT_MS || 10000),
  },
  domains: {
    a_target: process.env.DOMAIN_A_TARGET || '76.76.21.21',
    cname_target: process.env.DOMAIN_CNAME_TARGET || 'cname.realestate-saas.com',
  },
  bkash: {
    grant_token_url: process.env.BKASH_GRANT_TOKEN_URL,
    create_payment_url: process.env.BKASH_CREATE_PAYMENT_URL,
    execute_payment_url: process.env.BKASH_EXECUTE_PAYMENT_URL,
    query_payment_url: process.env.BKASH_QUERY_PAYMENT_URL,
    refund_url: process.env.BKASH_REFUND_URL,
    app_key: process.env.BKASH_APP_KEY,
    app_secret: process.env.BKASH_APP_SECRET,
    username: process.env.BKASH_USERNAME,
    password: process.env.BKASH_PASSWORD,
    timeout_ms: Number(process.env.BKASH_TIMEOUT_MS || 10000),
  },
}
