import type { Request } from 'express'

export type HttpLogLevel = 'info' | 'warn' | 'error'

const QUERYLESS_PATH = /\?.*$/

export const requestRoute = (req: Pick<Request, 'originalUrl' | 'path' | 'baseUrl' | 'route'>): string => {
  const routePath = typeof req.route?.path === 'string' ? req.route.path : ''
  const baseUrl = String(req.baseUrl || '')
  if (routePath) return `${baseUrl}${routePath}`.replace(/\/+/g, '/') || '/'
  return String(req.originalUrl || req.path || '/').replace(QUERYLESS_PATH, '') || '/'
}

export const httpLogLevelForStatus = (statusCode: number, errorCode?: string): HttpLogLevel => {
  if (statusCode >= 500) return 'error'
  if (statusCode === 403 || statusCode === 409 || statusCode === 429) return 'warn'
  if (statusCode === 400 && errorCode && !['VALIDATION_ERROR', 'BAD_REQUEST'].includes(errorCode)) return 'warn'
  if (statusCode >= 400) return 'info'
  return 'info'
}

export const httpErrorEvent = (statusCode: number): 'request_failed' | 'request_rejected' =>
  statusCode >= 500 ? 'request_failed' : 'request_rejected'

export const isUnexpectedServerError = (statusCode: number): boolean => statusCode >= 500
