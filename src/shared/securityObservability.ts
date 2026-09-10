import { createHash } from 'crypto'
import type { Request } from 'express'
import { logger } from './logger'
import { Metrics } from './metrics'
import { requestRoute } from './httpObservability'

type SecurityRejectionKind = 'authentication' | 'authorization' | 'rate_limit' | 'server_error'

const bounded = (value: unknown, max = 120): string => String(value ?? '')
  .replace(/[^a-zA-Z0-9_.:/-]/g, '_')
  .slice(0, max)

export const hashSecurityIdentifier = (value: unknown): string => createHash('sha256')
  .update(String(value ?? '').trim().toLowerCase())
  .digest('hex')
  .slice(0, 20)

export const recordSecurityRejection = (input: {
  req: Request
  statusCode: number
  errorCode?: string
}): void => {
  const { req, statusCode } = input
  let kind: SecurityRejectionKind | null = null
  if (statusCode === 401) kind = 'authentication'
  else if (statusCode === 403) kind = 'authorization'
  else if (statusCode === 429) kind = 'rate_limit'
  else if (statusCode >= 500) kind = 'server_error'
  if (!kind) return

  const route = requestRoute(req)
  const status = String(statusCode)
  Metrics.inc('security_request_rejections_total', { kind, method: req.method.toUpperCase(), route: Metrics.normalizeRoute(route), status })

  if (kind === 'authentication' || kind === 'authorization') {
    logger.warn('security_access_rejected', {
      event: 'security_access_rejected',
      kind,
      requestId: req.requestId,
      method: req.method,
      route,
      statusCode,
      errorCode: bounded(input.errorCode || 'ACCESS_REJECTED'),
      organizationId: req.tenant?.organizationId,
      userId: req.user?._id,
      networkHash: hashSecurityIdentifier(req.ip || req.socket.remoteAddress || 'unknown'),
    })
  }
}

export const recordRateLimitRejection = (input: {
  limiter: string
  rule: string
  route: string
}): void => {
  Metrics.inc('security_rate_limit_rejections_total', {
    limiter: bounded(input.limiter, 64),
    rule: bounded(input.rule, 64),
    route: Metrics.normalizeRoute(input.route),
  })
}

export const recordUsageBudgetRejection = (input: { kind: string; reason: string }): void => {
  Metrics.inc('security_usage_budget_rejections_total', {
    kind: bounded(input.kind, 40),
    reason: bounded(input.reason, 24),
  })
}

export const recordUsageBudgetReservation = (input: { kind: string; units: number; globalUsed: number; globalLimit: number }): void => {
  const kind = bounded(input.kind, 40)
  const units = Math.max(0, Math.floor(input.units || 0))
  Metrics.inc('security_usage_reserved_units_total', { kind }, units)
  Metrics.setGauge('security_usage_global_used', Math.max(0, input.globalUsed || 0), { kind })
  Metrics.setGauge('security_usage_global_limit', Math.max(1, input.globalLimit || 1), { kind })
  Metrics.setGauge('security_usage_global_utilization_ratio', Math.max(0, Math.min(1, (input.globalUsed || 0) / Math.max(1, input.globalLimit || 1))), { kind })
}

export const recordUploadSuccess = (input: { kind: 'public-image' | 'private-document'; bytes: number }): void => {
  Metrics.inc('security_uploads_total', { kind: input.kind, outcome: 'accepted' })
  Metrics.inc('security_upload_bytes_total', { kind: input.kind }, Math.max(0, Math.floor(input.bytes || 0)))
}
