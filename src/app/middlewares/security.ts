import crypto from 'crypto'
import { NextFunction, Request, Response } from 'express'
import config from '../../config'
import ApiError from '../../errors/ApiError'
import { RequestContext } from '../../shared/requestContext'
import { isPublicCorsRequest, isTrustedApplicationOrigin } from './corsPolicy'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// These endpoints authenticate with credentials/OTP/reset tokens from the request body,
// not with an existing cookie session. They must remain usable when a browser still
// carries stale access/refresh cookies from an older session.
const CSRF_EXEMPT_POST_PATHS = new Set([
  '/api/v1/auth/register-agency',
  '/api/v1/auth/signup',
  '/api/v1/auth/login',
  '/api/v1/auth/verify',
  '/api/v1/auth/resend_otp',
  '/api/v1/auth/password-reset/request',
  '/api/v1/auth/password-reset/verify',
  '/api/v1/auth/password-reset/complete',
  '/api/v1/auth/reset_password',
  '/api/v1/lead/public-capture',
  '/api/v1/viewing/public-request',
  '/api/v1/moderation/fraud-reports',
  '/api/v1/team-invitations/accept',
])

const PUBLIC_CROSS_ORIGIN_POST_PATTERNS = [
  /^\/api\/v1\/meta\/public\/[^/]+\/events$/,
]

const normalizePath = (value: string): string => {
  const pathname = value.split('?')[0] || '/'
  if (pathname === '/') return pathname
  return pathname.replace(/\/+$/, '')
}

export const isCsrfExemptRequest = (req: Pick<Request, 'method' | 'originalUrl'>): boolean => {
  if (req.method.toUpperCase() !== 'POST') return false
  const path = normalizePath(req.originalUrl)
  return CSRF_EXEMPT_POST_PATHS.has(path) || PUBLIC_CROSS_ORIGIN_POST_PATTERNS.some((pattern) => pattern.test(path))
}

export const requestContext = (req: Request, res: Response, next: NextFunction): void => {
  const supplied = req.get('x-request-id')
  req.requestId = supplied && /^[A-Za-z0-9._-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID()
  res.setHeader('x-request-id', req.requestId)
  RequestContext.run({ requestId: req.requestId, traceparent: req.get('traceparent') }, () => {
    res.setHeader('traceparent', RequestContext.childTraceparent())
    next()
  })
}

export const csrfProtection = (req: Request, _res: Response, next: NextFunction): void => {
  const origin = req.get('origin')
  if (origin && !isPublicCorsRequest(req) && !isTrustedApplicationOrigin(origin)) {
    return next(new ApiError(403, 'Origin is not allowed'))
  }


  if (SAFE_METHODS.has(req.method.toUpperCase()) || isCsrfExemptRequest(req)) return next()

  const cookieAuth = Boolean(
    req.cookies?.[config.security.access_cookie_name] || req.cookies?.[config.security.refresh_cookie_name],
  )
  if (!cookieAuth) return next()

  const cookieToken = req.cookies?.[config.security.csrf_cookie_name]
  const headerToken = req.get('x-csrf-token')

  if (typeof cookieToken !== 'string' || typeof headerToken !== 'string') {
    return next(new ApiError(403, 'Invalid CSRF token'))
  }

  const cookieBuffer = Buffer.from(cookieToken)
  const headerBuffer = Buffer.from(headerToken)
  if (cookieBuffer.length !== headerBuffer.length || !crypto.timingSafeEqual(cookieBuffer, headerBuffer)) {
    return next(new ApiError(403, 'Invalid CSRF token'))
  }

  next()
}

export const verifyCronSignature = (req: Request, _res: Response, next: NextFunction): void => {
  const timestamp = req.get('x-cron-timestamp') || ''
  const signature = req.get('x-cron-signature') || ''
  if (!Number(timestamp) || Math.abs(Date.now() - Number(timestamp) * 1000) > 300000) {
    return next(new ApiError(401, 'Invalid scheduler timestamp'))
  }
  const expected = crypto
    .createHmac('sha256', config.security.cron_signing_secret)
    .update(`${timestamp}.${req.method}.${req.baseUrl}${req.path}`)
    .digest('hex')
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return next(new ApiError(401, 'Invalid scheduler signature'))
  }
  next()
}
