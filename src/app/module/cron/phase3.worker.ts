import config from '../../../config'
import { logger } from '../../../shared/logger'
import { Metrics } from '../../../shared/metrics'
import { WebsiteBuilderService } from '../websiteBuilder/websiteBuilder.service'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { Lead } from '../lead/lead.model'
import { SubscriptionPlanService } from '../subscriptionPlan/subscriptionPlan.service'
import { EntitlementService } from '../entitlement/entitlement.service'
import { SubscriptionScheduleService } from '../subscription/subscriptionSchedule.service'

let running = false
let cleanupTick = 0
let lastRunAt = 0
let lastSuccessAt = 0
let lastDurationMs = 0
let lastError = ''
let interval: NodeJS.Timeout | null = null
let initial: NodeJS.Timeout | null = null

export const runPhase3Maintenance = async () => {
  if (running) return { skipped: true }
  running = true
  lastRunAt = Date.now()
  const started = performance.now()
  try {
    const [scheduled, metaScheduled, domainScheduled, calendarScheduled] = await Promise.all([
      WebsiteBuilderService.processScheduledPublishes(25),
      OperationsQueueService.schedulePendingMeta(100),
      OperationsQueueService.schedulePendingDomainChecks(100),
      OperationsQueueService.schedulePendingCalendarSync(50),
    ])
    const [operations, planVersions, scheduledSubscriptionChanges, sla, leadAllowanceReservations] = await Promise.all([
      OperationsQueueService.processDue(config.runtime.worker_batch_size),
      SubscriptionPlanService.applyDuePlanVersions(),
      SubscriptionScheduleService.processDueChanges(Math.max(25, config.runtime.worker_batch_size)),
      Lead.updateMany({ firstResponseAt: { $exists: false }, responseDueAt: { $lt: new Date() }, slaBreachedAt: { $exists: false } }, { $set: { slaBreachedAt: new Date() } }),
      EntitlementService.cleanupStaleLeadAllowanceReservations(100),
    ])
    const [backlog, domainBacklog] = await Promise.all([OperationsQueueService.backlog(), OperationsQueueService.domainBacklog()])
    Metrics.setGauge('operations_queue_pending', backlog.pending)
    Metrics.setGauge('operations_queue_failed', backlog.failed)
    Metrics.setGauge('operations_queue_oldest_age_seconds', backlog.oldestPendingAt ? Math.max(0, (Date.now() - new Date(backlog.oldestPendingAt).getTime()) / 1000) : 0)
    Metrics.setGauge('domain_queue_pending', domainBacklog.pending)
    Metrics.setGauge('domain_queue_processing', domainBacklog.processing)
    Metrics.setGauge('domain_queue_failed', domainBacklog.failed)
    Metrics.setGauge('domain_queue_oldest_age_seconds', domainBacklog.oldestPendingAt ? Math.max(0, (Date.now() - new Date(domainBacklog.oldestPendingAt).getTime()) / 1000) : 0)
    cleanupTick += 1
    const cleanupEvery = Math.max(1, Math.round(24 * 60 * 60 * 1000 / config.runtime.worker_poll_ms))
    const propertyDraftCleanupEvery = Math.max(1, Math.round(config.assets.property_draft_cleanup_interval_minutes * 60_000 / config.runtime.worker_poll_ms))
    const assets = cleanupTick % cleanupEvery === 0 ? await WebsiteBuilderService.cleanupOrphanAssets(100) : { checked: 0, deleted: 0 }
    const propertyDraftAssets = cleanupTick % propertyDraftCleanupEvery === 0
      ? await WebsiteBuilderService.cleanupAbandonedPropertyDraftAssets(100)
      : { sessions: 0, checked: 0, deleted: 0, reconciled: 0, bytesReleased: 0, incompleteUploadsDeleted: 0 }
    lastSuccessAt = Date.now(); lastError = ''
    lastDurationMs = performance.now() - started
    Metrics.setGauge('worker_last_success_timestamp_seconds', lastSuccessAt / 1000)
    Metrics.setGauge('worker_last_duration_ms', lastDurationMs)
    return { scheduled, metaScheduled, domainScheduled, calendarScheduled, operations, backlog, domainBacklog, planVersions, scheduledSubscriptionChanges, slaMarked: sla.modifiedCount, leadAllowanceReservations, assets, propertyDraftAssets }
  } catch (error) {
    lastError = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
    lastDurationMs = performance.now() - started
    throw error
  } finally { running = false }
}

export const getWorkerHealth = () => {
  const grace = Math.max(30_000, config.runtime.worker_poll_ms * 4)
  const healthy = !config.runtime.worker_enabled || (lastSuccessAt > 0 ? Date.now() - lastSuccessAt < grace : Date.now() - lastRunAt < grace)
  return { enabled: config.runtime.worker_enabled, scheduled: Boolean(interval), healthy, running, lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null, lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null, lastDurationMs: Math.round(lastDurationMs), lastError }
}

export const startPhase3Worker = () => {
  if (!config.runtime.worker_enabled || interval) return () => undefined
  interval = setInterval(() => { void runPhase3Maintenance().catch((error) => logger.error('[Operations worker] maintenance failed', { error })) }, config.runtime.worker_poll_ms)
  interval.unref()
  initial = setTimeout(() => { void runPhase3Maintenance().catch((error) => logger.error('[Operations worker] initial maintenance failed', { error })) }, 1000)
  initial.unref()
  return () => {
    if (interval) clearInterval(interval)
    if (initial) clearTimeout(initial)
    interval = null; initial = null
  }
}
