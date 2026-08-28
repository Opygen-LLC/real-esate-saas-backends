import { logger } from '../../../shared/logger'
import { Metrics } from '../../../shared/metrics'
import { CacheInvalidationService } from '../domainEvent/cacheInvalidation.service'
import { MetaEvent } from '../metaIntegration/metaEvent.model'
import { OperationsJob } from '../operationsQueue/operationsJob.model'
import { Organization } from '../organization/organization.model'
import { NextRevalidationService } from '../realtime/nextRevalidation.service'
import { RealtimeService } from '../realtime/realtime.service'
import { WebsitePage } from '../websiteBuilder/websitePage.model'
import { evaluateTenantAccessOrganization } from './tenantAccess.policy'
import type { EffectiveTenantAccess, TenantAccessOrganizationShape } from './tenantAccess.types'

export const ACCESS_CONTROLLED_OPERATION_TYPES = [
  'task_reminder',
  'viewing_reminder',
  'calendar_sync',
  'sms_send',
  'meta_capi',
] as const

export const MAINTENANCE_OPERATION_TYPES = ['domain_verify', 'asset_finalize', 'support_email'] as const

const ACCESS_CONTROLLED_OPERATION_TYPE_SET = new Set<string>(ACCESS_CONTROLLED_OPERATION_TYPES)

export const isAccessControlledOperationType = (type: string): boolean =>
  ACCESS_CONTROLLED_OPERATION_TYPE_SET.has(String(type || ''))

const deferBackgroundWork = async (organizationId: string, now: Date) => {
  const [jobs, metaEvents, scheduledPages] = await Promise.all([
    OperationsJob.updateMany(
      {
        organizationId,
        type: { $in: ACCESS_CONTROLLED_OPERATION_TYPES },
        status: 'pending',
        accessDeferredAt: null,
      },
      { $set: { accessDeferredAt: now, lastError: 'Deferred while tenant runtime access is inactive' } },
    ),
    MetaEvent.updateMany(
      { organizationId, status: 'queued' },
      { $set: { accessDeferredAt: now } },
    ),
    WebsitePage.updateMany(
      { organizationId, status: 'scheduled', accessDeferredAt: null },
      { $set: { accessDeferredAt: now } },
    ),
  ])
  return {
    deferredJobs: jobs.modifiedCount,
    deferredMetaEvents: metaEvents.modifiedCount,
    deferredScheduledPages: scheduledPages.modifiedCount,
  }
}

const resumeBackgroundWork = async (organizationId: string, now: Date) => {
  const [jobs, metaEvents, scheduledPages] = await Promise.all([
    OperationsJob.updateMany(
      {
        organizationId,
        type: { $in: ACCESS_CONTROLLED_OPERATION_TYPES },
        status: 'pending',
        accessDeferredAt: { $ne: null },
      },
      {
        $unset: { accessDeferredAt: 1 },
        $set: { lastError: '' },
      },
    ),
    MetaEvent.updateMany(
      { organizationId, status: 'queued', accessDeferredAt: { $ne: null } },
      {
        $unset: { accessDeferredAt: 1 },
        $min: { nextAttemptAt: now },
      },
    ),
    WebsitePage.updateMany(
      { organizationId, status: 'scheduled', accessDeferredAt: { $ne: null } },
      { $unset: { accessDeferredAt: 1 } },
    ),
  ])
  return {
    resumedJobs: jobs.modifiedCount,
    resumedMetaEvents: metaEvents.modifiedCount,
    resumedScheduledPages: scheduledPages.modifiedCount,
  }
}

type SyncInput = {
  organizationId: string
  source: string
  organization?: TenantAccessOrganizationShape | null
  eventType?: string
}

const sync = async (input: SyncInput): Promise<EffectiveTenantAccess | null> => {
  const organizationId = String(input.organizationId || '').trim()
  if (!organizationId || organizationId === '__platform__') return null

  const organization: any = input.organization || await Organization.findOne({ organizationId })
    .select('organizationId isBlocked platformAccess.status websiteStatus subscription')
    .lean()
  if (!organization) return null

  const access = evaluateTenantAccessOrganization(organization as TenantAccessOrganizationShape)
  const now = new Date()
  let identifiers: string[] = []

  try {
    identifiers = await CacheInvalidationService.invalidateTenant(organizationId)
  } catch (error) {
    Metrics.inc('tenant_access_cache_invalidation_failures_total', { source: input.source })
    logger.warn('tenant_access_cache_invalidation_failed', { organizationId, source: input.source, error })
  }

  try {
    await NextRevalidationService.trigger({
      organizationId,
      eventType: input.eventType || 'organization.tenant_access_changed',
      publicVisible: true,
      tenantIdentifiers: identifiers,
    })
  } catch (error) {
    Metrics.inc('tenant_access_next_revalidation_failures_total', { source: input.source })
    logger.warn('tenant_access_next_revalidation_failed', { organizationId, source: input.source, error })
  }

  try {
    if (access.backgroundBusinessWorkAllowed) await resumeBackgroundWork(organizationId, now)
    else await deferBackgroundWork(organizationId, now)
  } catch (error) {
    Metrics.inc('tenant_access_background_sync_failures_total', { source: input.source })
    logger.warn('tenant_access_background_sync_failed', { organizationId, source: input.source, error })
  }

  try {
    if (access.workspaceAllowed) {
      RealtimeService.emitOrganization(organizationId, {
        type: 'subscription.changed',
        action: 'access_restored',
        entityId: access.subscriptionStatus,
        eventType: input.eventType || 'organization.tenant_access_changed',
        payload: { status: access.subscriptionStatus, workspaceAllowed: true },
      })
      if (access.publicWebsiteAllowed) {
        RealtimeService.emitPublicOrganization(organizationId, {
          type: 'organization.changed',
          action: 'access_restored',
          entityId: 'tenant_access',
        })
      } else {
        await RealtimeService.disconnectPublicOrganization(organizationId)
      }
    } else {
      await RealtimeService.revokeTenantRuntimeAccess({
        organizationId,
        reason: access.reason,
        subscriptionStatus: access.subscriptionStatus,
      })
    }
  } catch (error) {
    Metrics.inc('tenant_access_realtime_sync_failures_total', { source: input.source })
    logger.warn('tenant_access_realtime_sync_failed', { organizationId, source: input.source, error })
  }

  Metrics.inc('tenant_access_transition_sync_total', {
    source: input.source,
    workspaceAllowed: String(access.workspaceAllowed),
    publicWebsiteAllowed: String(access.publicWebsiteAllowed),
  })
  return access
}

export const TenantAccessTransitionService = {
  sync,
  deferBackgroundWork,
  resumeBackgroundWork,
  isAccessControlledOperationType,
}
