import { logger } from '../../../shared/logger'
import { DomainService } from '../domain/domain.service'
import { MetaIntegrationService } from '../metaIntegration/metaIntegration.service'
import { WebsiteBuilderService } from '../websiteBuilder/websiteBuilder.service'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { Lead } from '../lead/lead.model'

let running = false
let cleanupTick = 0

export const runPhase3Maintenance = async () => {
  if (running) return { skipped: true }
  running = true
  try {
    const [scheduled, domains, meta, operations] = await Promise.all([
      WebsiteBuilderService.processScheduledPublishes(25),
      DomainService.retryDue(50),
      MetaIntegrationService.processQueue(50),
      OperationsQueueService.processDue(50),
    ])
    const calendar = await OperationsQueueService.schedulePendingCalendarSync(25)
    cleanupTick += 1
    const assets = cleanupTick % 1440 === 0 ? await WebsiteBuilderService.cleanupOrphanAssets(100) : { checked: 0, deleted: 0 }
    const sla = await Lead.updateMany({ firstResponseAt: { $exists: false }, responseDueAt: { $lt: new Date() }, slaBreachedAt: { $exists: false } }, { $set: { slaBreachedAt: new Date() } })
    return { scheduled, domains, meta, operations, calendar, slaMarked: sla.modifiedCount, assets }
  } finally { running = false }
}

export const startPhase3Worker = () => {
  const timer = setInterval(() => { void runPhase3Maintenance().catch((error) => logger.error('[Phase3 worker] maintenance failed', { message: error instanceof Error ? error.message : String(error) })) }, 60_000)
  timer.unref()
  const initial = setTimeout(() => { void runPhase3Maintenance().catch(() => undefined) }, 5_000)
  initial.unref()
}
