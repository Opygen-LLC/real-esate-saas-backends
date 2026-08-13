import crypto from 'crypto'
import { NextFunction, Request, Response } from 'express'
import config from '../../config'
import ApiError from '../../errors/ApiError'

export const requestContext = (req: Request, res: Response, next: NextFunction): void => {
  const supplied = req.get('x-request-id')
  req.requestId = supplied && /^[A-Za-z0-9._-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID()
  res.setHeader('x-request-id', req.requestId); next()
}
export const csrfProtection = (req: Request, _res: Response, next: NextFunction): void => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const cookieAuth = Boolean(req.cookies?.[config.security.access_cookie_name] || req.cookies?.[config.security.refresh_cookie_name])
  if (!cookieAuth) return next()
  const cookieToken = req.cookies?.[config.security.csrf_cookie_name]
  const headerToken = req.get('x-csrf-token')
  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length || !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
    return next(new ApiError(403, 'Invalid CSRF token'))
  }
  next()
}
export const verifyCronSignature = (req: Request, _res: Response, next: NextFunction): void => {
  const timestamp = req.get('x-cron-timestamp') || ''; const signature = req.get('x-cron-signature') || ''
  if (!Number(timestamp) || Math.abs(Date.now() - Number(timestamp) * 1000) > 300000) return next(new ApiError(401, 'Invalid scheduler timestamp'))
  const expected = crypto.createHmac('sha256', config.security.cron_signing_secret)
    .update(`${timestamp}.${req.method}.${req.baseUrl}${req.path}`).digest('hex')
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return next(new ApiError(401, 'Invalid scheduler signature'))
  next()
}
