import { Metrics } from '../../../shared/metrics'
import { Organization } from '../organization/organization.model'
import { evaluateTenantAccessOrganization, isTenantSubscriptionAccessible } from './tenantAccess.policy'
import type { EffectiveTenantAccess, TenantAccessReason, TenantAccessOrganizationShape } from './tenantAccess.types'

const LOCK_REASONS: TenantAccessReason[] = [
  'PLATFORM_SUSPENDED',
  'PLATFORM_ARCHIVED',
  'TENANT_PENDING_DELETION',
  'TRIAL_ENDED',
  'TRIAL_EXPIRED',
  'PAYMENT_PAST_DUE',
  'SUBSCRIPTION_GRACE',
  'SUBSCRIPTION_EXPIRED',
]

const recordEvaluation = (access: EffectiveTenantAccess): void => {
  if (!access.workspaceAllowed) {
    Metrics.inc('tenant_access_locked_total', {
      reason: access.reason,
    })
  }
}

const recordPublicDenied = (access: EffectiveTenantAccess): void => {
  Metrics.inc('public_site_access_denied_total', { reason: access.reason })
}

const recordSubscriptionReactivation = (input: {
  previousStatus?: string | null
  nextStatus?: string | null
  source: string
}): void => {
  const previousStatus = String(input.previousStatus || '')
  const nextStatus = String(input.nextStatus || '')
  if (!previousStatus || !nextStatus) return
  if (isTenantSubscriptionAccessible(previousStatus) || !isTenantSubscriptionAccessible(nextStatus)) return
  Metrics.inc('subscription_reactivation_total', {
    source: input.source,
    previous: previousStatus,
    next: nextStatus,
  })
}

/**
 * Refreshes aggregate access-lock gauges without high-cardinality tenant labels.
 * This is intentionally periodic rather than request-driven so the gauge reflects
 * current tenant state instead of request volume.
 */
const refreshLockReasonGauges = async (): Promise<{ locked: number; total: number }> => {
  const rows: any[] = await Organization.find({})
    .select('organizationId isBlocked platformAccess.status websiteStatus subscription')
    .lean()

  const counts = new Map<TenantAccessReason, number>(LOCK_REASONS.map((reason) => [reason, 0]))
  let locked = 0

  for (const row of rows) {
    const access = evaluateTenantAccessOrganization(row as TenantAccessOrganizationShape)
    if (access.workspaceAllowed) continue
    locked += 1
    if (counts.has(access.reason)) counts.set(access.reason, (counts.get(access.reason) || 0) + 1)
  }

  for (const reason of LOCK_REASONS) {
    Metrics.setGauge('tenant_access_lock_reason', counts.get(reason) || 0, { reason })
  }
  Metrics.setGauge('tenant_access_locked_tenants', locked)
  Metrics.setGauge('tenant_access_tenants_total', rows.length)
  Metrics.setGauge('tenant_access_metrics_last_success_timestamp_seconds', Date.now() / 1000)
  return { locked, total: rows.length }
}

export const TenantAccessMonitoringService = {
  recordEvaluation,
  recordPublicDenied,
  recordSubscriptionReactivation,
  refreshLockReasonGauges,
}
