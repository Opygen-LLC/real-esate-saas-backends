import type { NextFunction, Request, Response } from 'express'
import { logger } from '../../shared/logger'
import { Metrics } from '../../shared/metrics'
import { requestRoute } from '../../shared/httpObservability'
import { hashSecurityIdentifier } from '../../shared/securityObservability'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const categoryFor = (route: string, method: string): string | null => {
  if (route.startsWith('/api/v1/platform-admin') || route.startsWith('/api/v1/platform-settings')) return 'platform_admin'
  if (!MUTATING_METHODS.has(method)) return null
  if (route.startsWith('/api/v1/finance') || route.startsWith('/api/v1/billing') || route.startsWith('/api/v1/customers')) return 'finance'
  if (route.startsWith('/api/v1/users') || route.startsWith('/api/v1/team-invitations')) return 'identity_access'
  if (route.startsWith('/api/v1/upload') || route.startsWith('/api/upload') || route.startsWith('/upload')) return 'file_operation'
  if (route.startsWith('/api/v1/organization/website')) return 'website_change'
  if (route.startsWith('/api/v1/domain')) return 'domain_change'
  if (route.startsWith('/api/v1/auth') && /(?:forgot|reset|password|otp|verify|logout|refresh)/i.test(route)) return 'account_recovery_session'
  return null
}

/**
 * Emits body-free, query-free structured audit telemetry for high-risk request
 * families. Domain services keep writing their immutable business audit rows;
 * this middleware adds a uniform operational trail without ever serializing
 * credentials, request bodies, cookies or customer-entered values.
 */
export const securityAuditTrail = (req: Request, res: Response, next: NextFunction): void => {
  res.on('finish', () => {
    const route = requestRoute(req)
    const category = categoryFor(route, req.method.toUpperCase())
    if (!category) return
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`
    Metrics.inc('privileged_requests_total', { category, method: req.method.toUpperCase(), status: statusClass })
    logger.info('privileged_request_completed', {
      event: 'privileged_request_completed',
      category,
      requestId: req.requestId,
      method: req.method,
      route,
      statusCode: res.statusCode,
      organizationId: req.tenant?.organizationId,
      userId: req.user?._id,
      actorRole: req.user?.userRole,
      networkHash: hashSecurityIdentifier(req.ip || req.socket.remoteAddress || 'unknown'),
    })
  })
  next()
}
