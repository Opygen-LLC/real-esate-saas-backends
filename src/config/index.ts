import dotenv from 'dotenv'
import path from 'path'
import { z } from 'zod'

dotenv.config({
  path: path.join(process.cwd(), '.env'),
})

const isProduction = process.env.NODE_ENV === 'production'

const normalizeApiOrigin = (value: string): string => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('PUBLIC_API_URL must be a valid absolute URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('PUBLIC_API_URL must use http:// or https://')
  const pathname = parsed.pathname.replace(/\/$/, '')
  if (pathname && pathname !== '/api/v1') {
    throw new Error('PUBLIC_API_URL must be the API origin only (for example https://api.faysaldev.com)')
  }
  return parsed.origin
}

const isPrivateNetworkHost = (host: string): boolean => {
  const value = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!value) return false
  if (value === 'localhost' || value === '::1' || value === 'host.docker.internal') return true
  if (!value.includes('.') && !value.includes(':')) return true // Docker/private DNS service name (for example `redis`).
  if (/^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value)) return true
  const match = value.match(/^172\.(\d{1,3})\./)
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31)
}

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

const publicApiUrl = normalizeApiOrigin(process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 5000}`)
const defaultPublicSiteOrigin = isProduction ? 'https://realestate.opygen.com' : 'http://localhost:3000'
const configuredPublicSiteOrigin = (process.env.PUBLIC_SITE_ORIGIN || process.env.CLIENT_URL || defaultPublicSiteOrigin).replace(/\/$/, '')
const publicSiteOrigin = (() => {
  try {
    const parsed = new URL(configuredPublicSiteOrigin)
    const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname)
    // Invitation/review links must always point to the browser app, never a raw API/server IP.
    if (isProduction && isIpv4 && !process.env.PUBLIC_SITE_ORIGIN) return defaultPublicSiteOrigin
    return configuredPublicSiteOrigin
  } catch {
    return configuredPublicSiteOrigin
  }
})()

const publicApi = new URL(publicApiUrl)

if (!z.string().url().safeParse(publicSiteOrigin).success) {
  throw new Error('PUBLIC_SITE_ORIGIN must be a valid absolute URL')
}

const defaultAllowedOrigins = [
  ...(!isProduction ? ['*'] : []),
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'https://realestate.opygen.com',
]

if (process.env.CLIENT_URL) {
  defaultAllowedOrigins.push(process.env.CLIENT_URL)
}

const rawOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : defaultAllowedOrigins

const allowedOrigins = Array.from(
  new Set(
    rawOrigins
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean)
  )
)



// Authentication verification is email-first. SMS remains an optional CRM channel.

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
const smsEnabled = envBoolean('SMS_ENABLED', false)
const emailDevelopmentMode = envBoolean('EMAIL_DEV_MODE', !isProduction)
const redisEnabled = envBoolean('REDIS_ENABLED', Boolean(process.env.REDIS_HOST))
const redisTls = envBoolean('REDIS_TLS', false)
const redisAllowInsecurePrivateNetwork = envBoolean('REDIS_ALLOW_INSECURE_PRIVATE_NETWORK', false)
const redisHost = process.env.REDIS_HOST || '127.0.0.1'
const realtimeEnabled = envBoolean('REALTIME_ENABLED', true)
const nextRevalidateUrl = (process.env.NEXT_REVALIDATE_URL?.trim() || `${publicSiteOrigin}/api/revalidate`).replace(/\/$/, '')
const nextRevalidateSecret = process.env.NEXT_REVALIDATE_SECRET?.trim() || 'real_estate_saas_next_revalidate_secret_key_32bytes_production'
process.env.NEXT_REVALIDATE_SECRET = nextRevalidateSecret
if (nextRevalidateUrl && !z.string().url().safeParse(nextRevalidateUrl).success) throw new Error('NEXT_REVALIDATE_URL must be a valid absolute URL')

const domainProvider = (process.env.DOMAIN_PROVIDER?.trim().toLowerCase() || 'vercel')
const domainATarget = process.env.DOMAIN_A_TARGET?.trim() || (isProduction ? '' : '76.76.21.21')
const domainCnameTarget = (process.env.DOMAIN_CNAME_TARGET?.trim() || (isProduction ? '' : 'cname.vercel-dns.com')).replace(/\.$/, '')
const vercelProject = process.env.VERCEL_PROJECT_ID_OR_NAME?.trim() || ''
const vercelApiToken = process.env.VERCEL_API_TOKEN?.trim() || ''
const vercelTeamId = process.env.VERCEL_TEAM_ID?.trim() || ''
const vercelApiBase = (process.env.VERCEL_API_BASE?.trim() || 'https://api.vercel.com').replace(/\/$/, '')
if (!['vercel'].includes(domainProvider)) throw new Error('DOMAIN_PROVIDER must currently be vercel')
if (domainATarget && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(domainATarget)) throw new Error('DOMAIN_A_TARGET must be an IPv4 address')
if (domainCnameTarget && (domainCnameTarget.includes('://') || domainCnameTarget.includes('/'))) throw new Error('DOMAIN_CNAME_TARGET must be a hostname only')
if (!z.string().url().safeParse(vercelApiBase).success) throw new Error('VERCEL_API_BASE must be a valid absolute URL')

if (isProduction) {
  const requiredUrls = ['DATABASE_URL', 'PUBLIC_API_URL', 'CLIENT_URL', 'ALLOWED_ORIGINS']
  requiredUrls.forEach((name) => requiredInProduction(name))
  requiredInProduction('JWT_SECRET', 32)
  requiredInProduction('JWT_REFRESH_SECRET', 32)
  requiredInProduction('OTP_PEPPER', 32)
  requiredInProduction('CRON_SIGNING_SECRET', 32)
  requiredInProduction('DATA_ENCRYPTION_KEY', 32)
  requiredInProduction('NEXT_REVALIDATE_SECRET', 32)
  requiredInProduction('DOMAIN_A_TARGET')
  requiredInProduction('DOMAIN_CNAME_TARGET')
  if (domainProvider === 'vercel') {
    requiredInProduction('VERCEL_PROJECT_ID_OR_NAME')
    requiredInProduction('VERCEL_API_TOKEN', 20)
  }


  if (smsEnabled && smsDevelopmentMode) throw new Error('SMS_DEV_MODE must be false when SMS is enabled in production')
  if (redisEnabled) {
    requiredInProduction('REDIS_PASSWORD', 8)
    if (!redisTls) {
      if (!redisAllowInsecurePrivateNetwork) {
        throw new Error('REDIS_TLS must be true in production unless REDIS_ALLOW_INSECURE_PRIVATE_NETWORK=true is explicitly set for an isolated private network')
      }
      if (!isPrivateNetworkHost(redisHost)) {
        throw new Error('REDIS_ALLOW_INSECURE_PRIVATE_NETWORK may only be used with localhost, RFC1918, or private Docker DNS Redis hosts')
      }
    }
  }
  if (!emailDevelopmentMode) {
    requiredInProduction('SMTP_HOST')
    requiredInProduction('SMTP_USER')
    requiredInProduction('SMTP_PASSWORD', 8)
    requiredInProduction('SMTP_FROM')
  }
  if (smsEnabled) {
    const requiredSms = ['SMS_API_URL', 'SMS_API_TOKEN', 'SMS_SENDER_ID', 'SMS_WEBHOOK_SECRET']
    requiredSms.forEach((name) => requiredInProduction(name))
  }
}


for (const origin of allowedOrigins) {
  if (origin !== '*' && !z.string().url().safeParse(origin).success) throw new Error(`Invalid ALLOWED_ORIGINS entry: ${origin}`)
}


const privacyPolicyUrl = process.env.PRIVACY_POLICY_URL?.trim() || ''
const privacyPolicyVersion = process.env.PRIVACY_POLICY_VERSION?.trim() || ''
const privacyLegalReviewStatus = process.env.PRIVACY_LEGAL_REVIEW_STATUS?.trim().toLowerCase() || 'required'
if (privacyPolicyUrl && !z.string().url().safeParse(privacyPolicyUrl).success) throw new Error('PRIVACY_POLICY_URL must be a valid absolute URL')
if (!['required', 'approved'].includes(privacyLegalReviewStatus)) throw new Error('PRIVACY_LEGAL_REVIEW_STATUS must be required or approved')
if (privacyLegalReviewStatus === 'approved' && (!privacyPolicyUrl || !privacyPolicyVersion)) {
  throw new Error('PRIVACY_POLICY_URL and PRIVACY_POLICY_VERSION are required when PRIVACY_LEGAL_REVIEW_STATUS=approved')
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
  client_url: publicSiteOrigin,
  public_site_origin: publicSiteOrigin,
  allowed_origins: allowedOrigins,
  privacy: {
    policy_url: privacyPolicyUrl,
    policy_version: privacyPolicyVersion,
    legal_review_status: privacyLegalReviewStatus as 'required' | 'approved',
  },
  cookie_domain: cookieDomain,
  legacy_cookie_domain: legacyCookieDomain,
  cookie_secure: cookieSecure,
  cookie_same_site: cookieSameSite,
  database_string: process.env.DATABASE_URL || 'mongodb://127.0.0.1:27017/real-estate-saas',
  mongo: {
    max_pool_size: Math.max(5, Number(process.env.MONGO_MAX_POOL_SIZE || 50)),
    min_pool_size: Math.max(0, Number(process.env.MONGO_MIN_POOL_SIZE || 5)),
    server_selection_timeout_ms: Math.max(1000, Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000)),
    connect_timeout_ms: Math.max(1000, Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 10000)),
    socket_timeout_ms: Math.max(5000, Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 30000)),
    wait_queue_timeout_ms: Math.max(1000, Number(process.env.MONGO_WAIT_QUEUE_TIMEOUT_MS || 5000)),
    query_timeout_ms: Math.max(500, Number(process.env.MONGO_QUERY_TIMEOUT_MS || 10000)),
  },
  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS || '12',
  app_email: process.env.APP_EMAIL,
  app_password: process.env.APP_PASSWORD,
  email: {
    development_mode: emailDevelopmentMode,
    host: process.env.SMTP_HOST?.trim() || '',
    port: Math.max(1, Number(process.env.SMTP_PORT || 587)),
    secure: envBoolean('SMTP_SECURE', false),
    user: process.env.SMTP_USER?.trim() || process.env.APP_EMAIL?.trim() || '',
    password: process.env.SMTP_PASSWORD || process.env.APP_PASSWORD || '',
    from: process.env.SMTP_FROM?.trim() || process.env.APP_EMAIL?.trim() || '',
    connection_timeout_ms: Math.max(1000, Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 5000)),
    socket_timeout_ms: Math.max(1000, Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 10000)),
    verify_on_startup: envBoolean('SMTP_VERIFY_ON_STARTUP', isProduction),
    health_cache_ms: Math.max(5000, Number(process.env.SMTP_HEALTH_CACHE_MS || 60000)),
    max_attempts: Math.max(1, Math.min(4, Number(process.env.SMTP_MAX_ATTEMPTS || 2))),
    retry_delay_ms: Math.max(100, Number(process.env.SMTP_RETRY_DELAY_MS || 500)),
  },
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
    impersonation_cookie_name: 'supportImpersonationToken',
  },
  sms: {
    enabled: smsEnabled,
    development_mode: smsDevelopmentMode,
    api_url: smsApiUrl,
    api_token: process.env.SMS_API_TOKEN?.trim() || '',
    sender_id: process.env.SMS_SENDER_ID?.trim() || '',
    provider_name: process.env.SMS_PROVIDER_NAME?.trim() || 'generic-bd-http',
    balance_url: process.env.SMS_BALANCE_URL?.trim() || '',
    delivery_callback_url: process.env.SMS_DELIVERY_CALLBACK_URL?.trim() || '',
    webhook_secret: process.env.SMS_WEBHOOK_SECRET?.trim() || '',
    timeout_ms: Math.max(1000, Number(process.env.SMS_TIMEOUT_MS || 10000)),
  },
  domains: {
    provider: domainProvider,
    a_target: domainATarget,
    cname_target: domainCnameTarget,
    ownership_prefix: process.env.DOMAIN_OWNERSHIP_PREFIX || '_realestate-verification',
    public_site_origin: publicSiteOrigin,
    provider_timeout_ms: Math.max(1000, Math.min(20000, Number(process.env.DOMAIN_PROVIDER_TIMEOUT_MS || 8000))),
    provider_health_cache_ms: Math.max(5000, Math.min(300000, Number(process.env.DOMAIN_PROVIDER_HEALTH_CACHE_MS || 30000))),
    vercel_project: vercelProject,
    vercel_api_token: vercelApiToken,
    vercel_team_id: vercelTeamId,
    vercel_api_base: vercelApiBase,
  },
  realtime: {
    enabled: realtimeEnabled,
    ticket_ttl: process.env.REALTIME_TICKET_TTL || '60s',
    next_revalidate_url: nextRevalidateUrl,
    next_revalidate_secret: nextRevalidateSecret,
    revalidate_timeout_ms: Math.max(500, Math.min(10000, Number(process.env.NEXT_REVALIDATE_TIMEOUT_MS || 2500))),
  },
  redis: {
    enabled: redisEnabled,
    host: redisHost,
    port: Math.max(1, Number(process.env.REDIS_PORT || 6379)),
    username: process.env.REDIS_USERNAME || '',
    password: process.env.REDIS_PASSWORD || '',
    db: Math.max(0, Number(process.env.REDIS_DB || 0)),
    tls: redisTls,
    allow_insecure_private_network: redisAllowInsecurePrivateNetwork,
    servername: process.env.REDIS_TLS_SERVERNAME || '',
    reject_unauthorized: envBoolean('REDIS_TLS_REJECT_UNAUTHORIZED', true),
    connect_timeout_ms: Math.max(250, Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 1500)),
    command_timeout_ms: Math.max(250, Number(process.env.REDIS_COMMAND_TIMEOUT_MS || 1000)),
    key_prefix: (process.env.REDIS_KEY_PREFIX || 're-saas').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80) || 're-saas',
    cache_namespace: process.env.REDIS_CACHE_NAMESPACE || 'cache',
    queue_namespace: process.env.REDIS_QUEUE_NAMESPACE || 'queue',
  },
  assets: {
    bucket: process.env.OBJECT_STORAGE_BUCKET || '',
    region: process.env.OBJECT_STORAGE_REGION || 'auto',
    endpoint: (process.env.OBJECT_STORAGE_ENDPOINT || '').replace(/\/$/, ''),
    internal_endpoint: (process.env.OBJECT_STORAGE_INTERNAL_ENDPOINT || process.env.OBJECT_STORAGE_ENDPOINT || '').replace(/\/$/, ''),
    access_key_id: process.env.OBJECT_STORAGE_ACCESS_KEY_ID || '',
    secret_access_key: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || '',
    public_base_url: (process.env.OBJECT_STORAGE_PUBLIC_BASE_URL || '').replace(/\/$/, ''),
    signed_url_ttl_seconds: Math.max(60, Math.min(3600, Number(process.env.OBJECT_STORAGE_SIGNED_URL_TTL || 600))),
    health_timeout_ms: Math.max(500, Math.min(15000, Number(process.env.OBJECT_STORAGE_HEALTH_TIMEOUT_MS || 3000))),
    health_cache_ms: Math.max(1000, Math.min(60000, Number(process.env.OBJECT_STORAGE_HEALTH_CACHE_MS || 10000))),
    property_draft_ttl_minutes: Math.max(30, Math.min(1440, Number(process.env.PROPERTY_DRAFT_ASSET_TTL_MINUTES || 120))),
    property_draft_cleanup_interval_minutes: Math.max(5, Math.min(120, Number(process.env.PROPERTY_DRAFT_CLEANUP_INTERVAL_MINUTES || 15))),
    clamav_host: process.env.CLAMAV_HOST || '',
    clamav_port: Math.max(1, Number(process.env.CLAMAV_PORT || 3310)),
  },
  meta: {
    graph_version: process.env.META_GRAPH_API_VERSION || 'v26.0',
    graph_base_url: (process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com').replace(/\/$/, ''),
    max_attempts: Math.max(1, Number(process.env.META_CAPI_MAX_ATTEMPTS || 6)),
    timeout_ms: Math.max(1000, Number(process.env.META_CAPI_TIMEOUT_MS || 10000)),
  },
  calendar: {
    provider_approval_status: process.env.CALENDAR_PROVIDER_APPROVAL_STATUS || 'pending',
    sync_url: process.env.CALENDAR_SYNC_URL?.trim() || '',
    api_token: process.env.CALENDAR_SYNC_TOKEN?.trim() || '',
    timeout_ms: Math.max(1000, Number(process.env.CALENDAR_SYNC_TIMEOUT_MS || 10000)),
  },
  runtime: {
    worker_enabled: envBoolean('WORKER_ENABLED', true),
    worker_poll_ms: Math.max(1000, Number(process.env.WORKER_POLL_MS || 5000)),
    worker_batch_size: Math.max(1, Math.min(200, Number(process.env.WORKER_BATCH_SIZE || 50))),
    shutdown_timeout_ms: Math.max(1000, Number(process.env.SHUTDOWN_TIMEOUT_MS || 15000)),
    max_page_size: Math.max(10, Math.min(500, Number(process.env.MAX_PAGE_SIZE || 100))),
  },
  observability: {
    metrics_token: process.env.METRICS_TOKEN || 'real_estate_saas_metrics_token_production_default_32bytes',
    client_error_reporting_url: process.env.CLIENT_ERROR_REPORTING_URL?.trim() || '',
    client_error_reporting_token: process.env.CLIENT_ERROR_REPORTING_TOKEN?.trim() || '',
  },

  bkash: {
    enabled: envBoolean('BKASH_ENABLED', false),
    grant_token_url: process.env.BKASH_GRANT_TOKEN_URL?.trim() || '',
    create_payment_url: process.env.BKASH_CREATE_PAYMENT_URL?.trim() || '',
    execute_payment_url: process.env.BKASH_EXECUTE_PAYMENT_URL?.trim() || '',
    query_payment_url: process.env.BKASH_QUERY_PAYMENT_URL?.trim() || '',
    app_key: process.env.BKASH_APP_KEY?.trim() || '',
    app_secret: process.env.BKASH_APP_SECRET?.trim() || '',
    username: process.env.BKASH_USERNAME?.trim() || '',
    password: process.env.BKASH_PASSWORD?.trim() || '',
    timeout_ms: Math.max(1000, Number(process.env.BKASH_TIMEOUT_MS || 10000)),
  },
}

