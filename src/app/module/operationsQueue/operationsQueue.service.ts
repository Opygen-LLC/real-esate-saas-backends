import { randomUUID } from 'crypto'
import type { ClientSession } from 'mongoose'
import config from '../../../config'
import { logger } from '../../../shared/logger'
import { Metrics } from '../../../shared/metrics'
import { CalendarSyncService } from '../crm/calendarSync.service'
import { DomainService } from '../domain/domain.service'
import { DomainRecord } from '../domain/domain.model'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { MetaEvent } from '../metaIntegration/metaEvent.model'
import { MetaIntegrationService } from '../metaIntegration/metaIntegration.service'
import { Task } from '../task/task.model'
import { Viewing } from '../viewing/viewing.model'
import { NotificationService } from '../notification/notification.service'
import { Organization } from '../organization/organization.model'
import { SmsService } from '../sms/sms.service'
import { WebsiteAssetProcessor } from '../websiteBuilder/websiteAssetProcessor.service'
import sendEmail from '../../helpers/sendEmail'
import { OperationsJob, OperationsJobType } from './operationsJob.model'

const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`
let assetFinalizeFailuresSinceStart = 0

type QueueWriteOptions = { session?: ClientSession }


const tenantCanRunBackgroundWork = async (organizationId: string) => Boolean(await Organization.exists({
  organizationId,
  'platformAccess.status': { $ne: 'pending_deletion' },
}))

const schedule = async (
  input: { organizationId: string; type: OperationsJobType; entityId: string; runAt: Date; payload?: Record<string, unknown>; maxAttempts?: number },
  options: QueueWriteOptions = {},
) => {
  // Once hard deletion starts, no new tenant background work may be queued.
  // Existing API requests can still be unwinding on another replica, so this
  // database-backed barrier closes that race at the durable queue boundary.
  if (!(await tenantCanRunBackgroundWork(input.organizationId))) return null

  await OperationsJob.updateMany(
    { organizationId: input.organizationId, type: input.type, entityId: input.entityId, status: 'pending' },
    { $set: { status: 'cancelled' } },
    options.session ? { session: options.session } : undefined,
  )
  if (input.runAt.getTime() <= Date.now() && ['task_reminder', 'viewing_reminder'].includes(input.type)) return null

  const payload = {
    organizationId: input.organizationId,
    type: input.type,
    entityId: input.entityId,
    runAt: input.runAt,
    payload: input.payload || {},
    maxAttempts: Math.max(1, Math.min(10, input.maxAttempts || 5)),
  }

  if (options.session) return (await OperationsJob.create([payload], { session: options.session }))[0]
  return OperationsJob.create(payload)
}

const cancel = async (
  organizationId: string,
  type: OperationsJobType,
  entityId: string,
  options: QueueWriteOptions = {},
) => OperationsJob.updateMany(
  { organizationId, type, entityId, status: { $in: ['pending', 'processing'] } },
  { $set: { status: 'cancelled' } },
  options.session ? { session: options.session } : undefined,
)


const cancelOrganization = async (organizationId: string) => {
  const completedAt = new Date()
  const result = await OperationsJob.updateMany(
    { organizationId, status: { $in: ['pending', 'processing'] } },
    {
      $set: { status: 'cancelled', completedAt, lastError: 'Cancelled because the organization is being permanently deleted' },
      $unset: { lockedAt: 1, lockedBy: 1 },
    },
  )
  return { cancelled: result.modifiedCount }
}

const deliver = async (job: any) => {
  const [stillClaimed, tenantAllowed] = await Promise.all([
    OperationsJob.exists({ _id: job._id, status: 'processing', lockedBy: workerId }),
    tenantCanRunBackgroundWork(job.organizationId),
  ])
  if (!stillClaimed || !tenantAllowed) return

  if (job.type === 'support_email') {
    const { to, subject, html } = job.payload || {}
    if (to && subject && html) {
      await sendEmail(to, subject, html)
    }
    return
  }
  if (job.type === 'sms_send') {
    await SmsService.deliverPrepared(job.organizationId, job.payload || {})
    return
  }
  if (job.type === 'meta_capi') {
    await MetaIntegrationService.processById(job.entityId)
    return
  }
  if (job.type === 'domain_verify') {
    await DomainService.verifyById(job.entityId)
    return
  }
  if (job.type === 'asset_finalize') {
    await WebsiteAssetProcessor.finalize(job.organizationId, job.entityId, job.payload || {})
    return
  }
  if (job.type === 'calendar_sync') { await CalendarSyncService.syncViewing(job.entityId); return }
  if (job.type === 'task_reminder') {
    const task: any = await Task.findOne({ _id: job.entityId, organizationId: job.organizationId }).lean()
    if (!task || ['Completed', 'Cancelled'].includes(task.status)) return
    await NotificationService.createFromJob({ organizationId: job.organizationId, userId: task.assignedAgent?.toString(), jobId: job._id.toString(), type: 'task_reminder', title: task.title, body: `Due ${task.dueDate}${task.dueTime ? ` at ${task.dueTime}` : ''}`, entityId: job.entityId, leadId: task.linkedLead?.toString() })
    await DomainEventService.emit({ organizationId: job.organizationId, aggregateType: 'task', aggregateId: job.entityId, eventType: 'task.reminder_due', leadId: task.linkedLead?.toString(), actorId: task.assignedAgent?.toString(), payload: { summary: `Reminder due: ${task.title}`, dueDate: task.dueDate, dueTime: task.dueTime } })
    return
  }
  const viewing: any = await Viewing.findOne({ _id: job.entityId, organizationId: job.organizationId }).lean()
  if (!viewing || ['Completed', 'Cancelled', 'NoShow'].includes(viewing.status)) return
  await NotificationService.createFromJob({ organizationId: job.organizationId, userId: viewing.agentId?.toString(), jobId: job._id.toString(), type: 'viewing_reminder', title: `Viewing: ${viewing.clientName}`, body: `${viewing.date} at ${viewing.startTime}`, entityId: job.entityId, leadId: viewing.leadId?.toString() })
  await DomainEventService.emit({ organizationId: job.organizationId, aggregateType: 'viewing', aggregateId: job.entityId, eventType: 'viewing.reminder_due', leadId: viewing.leadId?.toString(), propertyId: viewing.propertyId?.toString(), actorId: viewing.agentId?.toString(), payload: { summary: `Viewing reminder for ${viewing.clientName}`, date: viewing.date, startTime: viewing.startTime } })
}

const claimOne = async () => OperationsJob.findOneAndUpdate(
  { type: { $ne: 'support_email' }, runAt: { $lte: new Date() }, $or: [{ status: 'pending' }, { status: 'processing', lockedAt: { $lte: new Date(Date.now() - 10 * 60_000) } }] },
  { $set: { status: 'processing', lockedAt: new Date(), lockedBy: workerId }, $inc: { attempts: 1 } },
  { new: true, sort: { runAt: 1 } },
)

const processOne = async (): Promise<'completed' | 'failed' | 'empty'> => {
  const job: any = await claimOne()
  if (!job) return 'empty'
  try {
    await deliver(job)
    const completedAt = new Date()
    await OperationsJob.updateOne({ _id: job._id, lockedBy: workerId, status: 'processing' }, { $set: { status: 'completed', completedAt, lastError: '' }, $unset: { lockedAt: 1, lockedBy: 1 } })
    if (job.type === 'domain_verify') {
      // A later successful lifecycle check supersedes historical dead jobs for
      // the same domain record. Without this cleanup the health endpoint would
      // remain permanently unhealthy even after the domain recovered.
      await OperationsJob.updateMany(
        { organizationId: job.organizationId, type: 'domain_verify', entityId: job.entityId, status: 'failed', _id: { $ne: job._id } },
        { $set: { status: 'cancelled', completedAt, lastError: 'Superseded by a successful domain verification' } },
      )
    }
    Metrics.observeQueue(job.type, 'completed')
    return 'completed'
  } catch (error) {
    const final = job.attempts >= job.maxAttempts
    const delayMs = Math.min(6 * 60 * 60_000, Math.max(30_000, 2 ** Math.min(job.attempts, 10) * 15_000))
    await OperationsJob.updateOne({ _id: job._id, lockedBy: workerId, status: 'processing' }, { $set: { status: final ? 'failed' : 'pending', lastError: error instanceof Error ? error.message.slice(0, 500) : 'Unknown operations error', runAt: new Date(Date.now() + delayMs) }, $unset: { lockedAt: 1, lockedBy: 1 } })
    Metrics.observeQueue(job.type, final ? 'dead' : 'retry')
    if (job.type === 'asset_finalize') {
      assetFinalizeFailuresSinceStart += 1
      Metrics.inc('property_media_upload_failures_total', { stage: 'asset_finalize', outcome: final ? 'dead' : 'retry' })
    }
    logger.error('[Operations queue] job failed', { jobId: job._id.toString(), type: job.type, final, error })
    return 'failed'
  }
}

const processDue = async (limit = config.runtime.worker_batch_size, concurrency = 6) => {
  let completed = 0; let failed = 0; let claimed = 0
  const worker = async () => {
    while (claimed < limit) {
      claimed += 1
      const result = await processOne()
      if (result === 'empty') return
      if (result === 'completed') completed += 1
      else failed += 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, limit) }, () => worker()))
  return { completed, failed }
}

const schedulePendingCalendarSync = async (limit = 25) => {
  if (config.calendar.provider_approval_status !== 'approved' || !config.calendar.sync_url || !config.calendar.api_token) return { scheduled: 0 }
  const candidates: any[] = await Viewing.find({ calendarSyncStatus: { $in: ['pending_provider_approval', 'not_configured', 'failed'] }, status: { $in: ['Scheduled', 'Confirmed', 'Rescheduled'] }, date: { $gte: new Date().toISOString().slice(0, 10) } }).select('_id organizationId').limit(limit).lean()
  const ids = candidates.map((item) => item._id.toString())
  const existing = new Set((await OperationsJob.find({ type: 'calendar_sync', entityId: { $in: ids }, status: { $in: ['pending', 'processing'] } }).select('entityId').lean()).map((job: any) => job.entityId))
  let scheduled = 0
  for (const viewing of candidates) {
    const entityId = viewing._id.toString()
    if (!existing.has(entityId)) { const job = await schedule({ organizationId: viewing.organizationId, type: 'calendar_sync', entityId, runAt: new Date(Date.now() + 250) }); if (job) scheduled += 1 }
  }
  return { scheduled }
}

const schedulePendingMeta = async (limit = 100) => {
  const candidates: any[] = await MetaEvent.find({ status: 'queued', nextAttemptAt: { $lte: new Date() } }).select('_id organizationId').sort({ nextAttemptAt: 1 }).limit(limit).lean()
  const ids = candidates.map((item) => item._id.toString())
  const existing = new Set((await OperationsJob.find({ type: 'meta_capi', entityId: { $in: ids }, status: { $in: ['pending', 'processing'] } }).select('entityId').lean()).map((job: any) => job.entityId))
  let scheduled = 0
  for (const event of candidates) {
    const entityId = event._id.toString()
    if (!existing.has(entityId)) {
      const job = await schedule({ organizationId: event.organizationId, type: 'meta_capi', entityId, runAt: new Date(Date.now() + 250), maxAttempts: config.meta.max_attempts })
      if (job) scheduled += 1
    }
  }
  return { scheduled }
}

const schedulePendingDomainChecks = async (limit = 100) => {
  const candidates: any[] = await DomainRecord.find({ entitlementStatus: { $ne: 'suspended' }, nextCheckAt: { $lte: new Date() } }).select('_id organizationId').sort({ nextCheckAt: 1 }).limit(limit).lean()
  const ids = candidates.map((item) => item._id.toString())
  const existing = new Set((await OperationsJob.find({ type: 'domain_verify', entityId: { $in: ids }, status: { $in: ['pending', 'processing'] } }).select('entityId').lean()).map((job: any) => job.entityId))
  let scheduled = 0
  for (const record of candidates) {
    const entityId = record._id.toString()
    if (!existing.has(entityId)) {
      const job = await schedule({ organizationId: record.organizationId, type: 'domain_verify', entityId, runAt: new Date(Date.now() + 250), maxAttempts: 8 })
      if (job) scheduled += 1
    }
  }
  return { scheduled }
}

const resolveFailedDomainChecks = async (entityId: string) => {
  if (!entityId) return { resolved: 0 }
  const result = await OperationsJob.updateMany(
    { type: 'domain_verify', entityId, status: 'failed' },
    { $set: { status: 'cancelled', completedAt: new Date(), lastError: 'Superseded by a successful manual domain verification' } },
  )
  return { resolved: result.modifiedCount }
}

const backlog = async () => {
  const [pending, failed, oldest] = await Promise.all([
    OperationsJob.countDocuments({ status: 'pending' }), OperationsJob.countDocuments({ status: 'failed' }),
    OperationsJob.findOne({ status: 'pending' }).sort({ runAt: 1 }).select('runAt').lean(),
  ])
  return { pending, failed, oldestPendingAt: (oldest as any)?.runAt || null }
}


const assetBacklog = async () => {
  const [pending, processing, failed, oldest] = await Promise.all([
    OperationsJob.countDocuments({ type: 'asset_finalize', status: 'pending' }),
    OperationsJob.countDocuments({ type: 'asset_finalize', status: 'processing' }),
    OperationsJob.countDocuments({ type: 'asset_finalize', status: 'failed' }),
    OperationsJob.findOne({ type: 'asset_finalize', status: 'pending' }).sort({ runAt: 1 }).select('runAt').lean(),
  ])
  return {
    pending,
    processing,
    failed,
    pendingAssetFinalizationCount: pending + processing,
    oldestPendingAt: (oldest as any)?.runAt || null,
    uploadFailuresSinceStart: assetFinalizeFailuresSinceStart,
  }
}

const domainBacklog = async () => {
  const [pending, processing, failed, oldest] = await Promise.all([
    OperationsJob.countDocuments({ type: 'domain_verify', status: 'pending' }),
    OperationsJob.countDocuments({ type: 'domain_verify', status: 'processing' }),
    OperationsJob.countDocuments({ type: 'domain_verify', status: 'failed' }),
    OperationsJob.findOne({ type: 'domain_verify', status: 'pending' }).sort({ runAt: 1 }).select('runAt').lean(),
  ])
  return { pending, processing, failed, oldestPendingAt: (oldest as any)?.runAt || null }
}

export const OperationsQueueService = { schedule, cancel, cancelOrganization, processDue, schedulePendingCalendarSync, schedulePendingMeta, schedulePendingDomainChecks, resolveFailedDomainChecks, backlog, domainBacklog, assetBacklog }
