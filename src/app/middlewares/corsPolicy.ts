import cors from 'cors'
import { Request } from 'express'
import config from '../../config'

const PUBLIC_EXACT_PATHS = new Set([
  '/api/v1/platform-settings/public',
  '/api/v1/lead/public-capture',
  '/api/v1/viewing/public-request',
  '/api/v1/moderation/fraud-reports',
])

const PUBLIC_PATH_PREFIXES = [
  '/api/v1/organization/public-site/',
  '/api/v1/organization/public/',
  '/api/v1/organization/website/public-site/',
  '/api/v1/property/public/',
  '/api/v1/property/public-detail/',
  '/api/v1/users/public/',
  '/api/v1/users/public-agent/',
  '/api/v1/property-type/public/',
  '/api/v1/amenity/public/',
  '/api/v1/banner/public/',
  '/api/v1/section/public/',
  '/api/v1/landing-page/public/',
  '/api/v1/meta/public/',
  '/api/v1/domain/resolve/',
  '/api/v1/domain/resolve-subdomain/',
]

const normalizeOrigin = (origin: string): string => origin.trim().replace(/\/$/, '')
const normalizePath = (value: string): string => (value.split('?')[0] || '/').replace(/\/+$/, '') || '/'

export const isPublicCorsRequest = (req: Pick<Request, 'originalUrl'>): boolean => {
  const path = normalizePath(req.originalUrl)
  return PUBLIC_EXACT_PATHS.has(path) || PUBLIC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
}

export const isTrustedApplicationOrigin = (origin: string): boolean => {
  const normalized = normalizeOrigin(origin)
  if (config.allowed_origins.includes('*')) return true
  if (config.allowed_origins.includes(normalized)) return true

  try {
    const candidate = new URL(normalized)
    const platform = new URL(config.domains.public_site_origin)
    return candidate.protocol === platform.protocol
      && (candidate.hostname === platform.hostname || candidate.hostname.endsWith(`.${platform.hostname}`))
  } catch {
    return false
  }
}

const sharedOptions: Pick<cors.CorsOptions, 'methods' | 'allowedHeaders' | 'exposedHeaders' | 'maxAge'> = {
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-CSRF-Token', 'X-Request-ID', 'Idempotency-Key', 'traceparent'],
  exposedHeaders: ['X-Request-ID', 'traceparent', 'Server-Timing'],
  maxAge: 86400,
}

export const corsOptionsDelegate: cors.CorsOptionsDelegate<Request> = (req, callback) => {
  const origin = req.get('origin')
  if (!origin) {
    callback(null, { ...sharedOptions, origin: true, credentials: true })
    return
  }

  // Public website endpoints are intentionally credential-less. They may be
  // called from verified custom domains, so they can reflect the requesting
  // origin without enabling credentialed cross-origin access.
  if (isPublicCorsRequest(req)) {
    callback(null, { ...sharedOptions, origin: true, credentials: false })
    return
  }

  const trusted = isTrustedApplicationOrigin(origin)
  callback(null, { ...sharedOptions, origin: trusted, credentials: trusted })
}
