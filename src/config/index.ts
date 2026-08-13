import dotenv from 'dotenv'
import path from 'path'
import { z } from 'zod'

dotenv.config({
  path: path.join(process.cwd(), '.env'),
})

const isProduction = process.env.NODE_ENV === 'production'

const envBoolean = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  if (raw === 'true' || raw === '1' || raw === 'yes') return true
  if (raw === 'false' || raw === '0' || raw === 'no') return false
  throw new Error(`${name} must be true or false`)
}

const requiredInProduction = (name: string, minimum = 1): string => {
  const value = process.env[name]?.trim()
  if (isProduction && (!value || value.length < minimum)) {
    throw new Error(`Missing or insecure production configuration: ${name}`)
  }
  return value || ''
}

const publicApiUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 5000}`

let publicApi: URL
try {
  publicApi = new URL(publicApiUrl)
} catch {
  throw new Error('PUBLIC_API_URL must be a valid absolute URL')
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean)

// Local/dev environments should never try to call an empty SMS URL. Production is
// deliberately the opposite: a real SMS provider is mandatory and console OTPs
// are rejected below.

const rawCookieDomain = process.env.COOKIE_DOMAIN?.trim() || ''
// Authentication cookies are intentionally host-only (no Domain attribute).
// This works for direct API requests and, importantly, allows the Next.js
// same-origin reverse proxy to bind the cookies to the frontend host (including
// localhost) instead of exposing them as third-party cookies. COOKIE_DOMAIN is
// retained only so older domain-scoped cookies can be cleared during migration.
const legacyCookieDomain = rawCookieDomain || undefined
if (legacyCookieDomain) {
  if (legacyCookieDomain.includes('://') || legacyCookieDomain.includes('/') || legacyCookieDomain.includes(':')) {
    throw new Error('COOKIE_DOMAIN must be a hostname/domain only (for example .faysaldev.com)')
  }

  const normalizedCookieDomain = legacyCookieDomain.replace(/^\./, '').toLowerCase()
  const apiHostname = publicApi.hostname.toLowerCase()
  if (apiHostname !== normalizedCookieDomain && !apiHostname.endsWith(`.${normalizedCookieDomain}`)) {
    throw new Error(`COOKIE_DOMAIN ${legacyCookieDomain} does not match PUBLIC_API_URL host ${apiHostname}`)
  }
}
const cookieDomain = undefined

const cookieSecure = envBoolean('COOKIE_SECURE', isProduction || publicApi.protocol === 'https:')
if (publicApi.protocol === 'https:' && !cookieSecure) {
  throw new Error('COOKIE_SECURE must be true when PUBLIC_API_URL uses https://')
}
const rawSameSite = process.env.COOKIE_SAME_SITE?.trim().toLowerCase()
if (rawSameSite && !['lax', 'strict', 'none'].includes(rawSameSite)) {
  throw new Error('COOKIE_SAME_SITE must be one of: lax, strict, none')
}
const cookieSameSite = (rawSameSite || (cookieSecure ? 'none' : 'lax')) as 'lax' | 'strict' | 'none'
if (cookieSameSite === 'none' && !cookieSecure) {
  throw new Error('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true')
}

const smsDevelopmentMode = envBoolean('SMS_DEV_MODE', !isProduction)

if (isProduction) {
  const requiredUrls = ['DATABASE_URL', 'PUBLIC_API_URL', 'CLIENT_URL', 'ALLOWED_ORIGINS']
  requiredUrls.forEach((name) => requiredInProduction(name))
  requiredInProduction('JWT_SECRET', 32)
  requiredInProduction('JWT_REFRESH_SECRET', 32)
  requiredInProduction('OTP_PEPPER', 32)
  requiredInProduction('CRON_SIGNING_SECRET', 32)
  requiredInProduction('DATA_ENCRYPTION_KEY', 32)

  if (smsDevelopmentMode) throw new Error('SMS_DEV_MODE must be false in production')
  const requiredSms = ['SMS_API_URL', 'SMS_API_TOKEN', 'SMS_SENDER_ID']
  requiredSms.forEach((name) => requiredInProduction(name))

  // Phase 3 publishing must fail at startup rather than silently accepting
  // uploads/domains that cannot be secured or scanned in production.
  ;['OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_ACCESS_KEY_ID', 'OBJECT_STORAGE_SECRET_ACCESS_KEY', 'OBJECT_STORAGE_PUBLIC_BASE_URL', 'CLAMAV_HOST', 'DOMAIN_A_TARGET', 'DOMAIN_CNAME_TARGET', 'DOMAIN_TLS_PROVIDER_URL', 'PUBLIC_SITE_ORIGIN'].forEach((name) => requiredInProduction(name))
}

for (const origin of allowedOrigins) {
  if (!z.string().url().safeParse(origin).success) throw new Error(`Invalid ALLOWED_ORIGINS entry: ${origin}`)
}

const smsApiUrl = process.env.SMS_API_URL?.trim() || ''
if (smsApiUrl && !z.string().url().safeParse(smsApiUrl).success) {
  throw new Error('SMS_API_URL must be a valid absolute URL')
}

export default {
  env: process.env.NODE_ENV || 'development',
  isProduction,
  port: Number(process.env.PORT || 5000),
  public_api_url: publicApiUrl,
  client_url: process.env.CLIENT_URL || 'http://localhost:3000',
  allowed_origins: allowedOrigins,
  cookie_domain: cookieDomain,
  legacy_cookie_domain: legacyCookieDomain,
  cookie_secure: cookieSecure,
  cookie_same_site: cookieSameSite,
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
    data_encryption_key: process.env.DATA_ENCRYPTION_KEY || 'development-only-data-encryption-key',
    csrf_cookie_name: 'csrfToken',
    access_cookie_name: 'accessToken',
    refresh_cookie_name: 'refreshToken',
  },
  sms: {
    development_mode: smsDevelopmentMode,
    api_url: smsApiUrl,
    api_token: process.env.SMS_API_TOKEN?.trim() || '',
    sender_id: process.env.SMS_SENDER_ID?.trim() || '',
    timeout_ms: Math.max(1000, Number(process.env.SMS_TIMEOUT_MS || 10000)),
  },
  domains: {
    a_target: process.env.DOMAIN_A_TARGET || '76.76.21.21',
    cname_target: (process.env.DOMAIN_CNAME_TARGET || 'cname.realestate-saas.com').replace(/\.$/, ''),
    ownership_prefix: process.env.DOMAIN_OWNERSHIP_PREFIX || '_realestate-verification',
    tls_provider_url: process.env.DOMAIN_TLS_PROVIDER_URL?.trim() || '',
    tls_provider_token: process.env.DOMAIN_TLS_PROVIDER_TOKEN?.trim() || '',
    public_site_origin: (process.env.PUBLIC_SITE_ORIGIN || process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, ''),
  },
  redis: {
    enabled: envBoolean('REDIS_ENABLED', Boolean(process.env.REDIS_HOST)),
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Math.max(1, Number(process.env.REDIS_PORT || 6379)),
    password: process.env.REDIS_PASSWORD || '',
    db: Math.max(0, Number(process.env.REDIS_DB || 0)),
  },
  assets: {
    bucket: process.env.OBJECT_STORAGE_BUCKET || '',
    region: process.env.OBJECT_STORAGE_REGION || 'auto',
    endpoint: (process.env.OBJECT_STORAGE_ENDPOINT || '').replace(/\/$/, ''),
    access_key_id: process.env.OBJECT_STORAGE_ACCESS_KEY_ID || '',
    secret_access_key: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || '',
    public_base_url: (process.env.OBJECT_STORAGE_PUBLIC_BASE_URL || '').replace(/\/$/, ''),
    signed_url_ttl_seconds: Math.max(60, Math.min(3600, Number(process.env.OBJECT_STORAGE_SIGNED_URL_TTL || 600))),
    clamav_host: process.env.CLAMAV_HOST || '',
    clamav_port: Math.max(1, Number(process.env.CLAMAV_PORT || 3310)),
  },
  meta: {
    graph_version: process.env.META_GRAPH_API_VERSION || 'v26.0',
    graph_base_url: (process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com').replace(/\/$/, ''),
    max_attempts: Math.max(1, Number(process.env.META_CAPI_MAX_ATTEMPTS || 6)),
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
