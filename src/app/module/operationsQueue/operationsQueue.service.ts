import config from '../../../config'
import { logger } from '../../../shared/logger'
import { CalendarSyncService } from '../crm/calendarSync.service'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { Task } from '../task/task.model'
import { Viewing } from '../viewing/viewing.model'
import { NotificationService } from '../notification/notification.service'
import { OperationsJob } from './operationsJob.model'

type OperationsJobType = 'task_reminder' | 'viewing_reminder' | 'calendar_sync'

const schedule = async (input: { organizationId: string; type: OperationsJobType; entityId: string; runAt: Date; payload?: Record<string, unknown> }) => {
  await OperationsJob.updateMany(
    { organizationId: input.organizationId, type: input.type, entityId: input.entityId, status: 'pending' },
    { $set: { status: 'cancelled' } },
  )
  if (input.runAt.getTime() <= Date.now() && input.type !== 'calendar_sync') return null
  return OperationsJob.create({ ...input, runAt: input.runAt.getTime() <= Date.now() ? new Date(Date.now() + 1_000) : input.runAt, payload: input.payload || {} })
}

const cancel = async (organizationId: string, type: OperationsJobType, entityId: string) => OperationsJob.updateMany(
  { organizationId, type, entityId, status: { $in: ['pending', 'processing'] } },
  { $set: { status: 'cancelled' } },
)

const deliver = async (job: any) => {
  if (job.type === 'calendar_sync') {
    await CalendarSyncService.syncViewing(job.entityId)
    return
  }
  if (job.type === 'task_reminder') {
    const task: any = await Task.findOne({ _id: job.entityId, organizationId: job.organizationId }).lean()
    if (!task || ['Completed', 'Cancelled'].includes(task.status)) return
    await NotificationService.createFromJob({ organizationId: job.organizationId, userId: task.assignedAgent?.toString(), jobId: job._id.toString(), type: 'task_reminder', title: task.title, body: `Due ${task.dueDate}${task.dueTime ? ` at ${task.dueTime}` : ''}`, entityId: job.entityId, leadId: task.linkedLead?.toString() })
    await DomainEventService.emit({
      organizationId: job.organizationId,
      aggregateType: 'task',
      aggregateId: job.entityId,
      eventType: 'task.reminder_due',
      leadId: task.linkedLead?.toString(),
      actorId: task.assignedAgent?.toString(),
      payload: { summary: `Reminder due: ${task.title}`, dueDate: task.dueDate, dueTime: task.dueTime },
    })
    return
  }
  const viewing: any = await Viewing.findOne({ _id: job.entityId, organizationId: job.organizationId }).lean()
  if (!viewing || ['Completed', 'Cancelled', 'NoShow'].includes(viewing.status)) return
  await NotificationService.createFromJob({ organizationId: job.organizationId, userId: viewing.agentId?.toString(), jobId: job._id.toString(), type: 'viewing_reminder', title: `Viewing: ${viewing.clientName}`, body: `${viewing.date} at ${viewing.startTime}`, entityId: job.entityId, leadId: viewing.leadId?.toString() })
  await DomainEventService.emit({
    organizationId: job.organizationId,
    aggregateType: 'viewing',
    aggregateId: job.entityId,
    eventType: 'viewing.reminder_due',
    leadId: viewing.leadId?.toString(),
    propertyId: viewing.propertyId?.toString(),
    actorId: viewing.agentId?.toString(),
    payload: { summary: `Viewing reminder for ${viewing.clientName}`, date: viewing.date, startTime: viewing.startTime },
  })
}

const processDue = async (limit = 50) => {
  let completed = 0
  let failed = 0
  for (let i = 0; i < limit; i += 1) {
    const stale = new Date(Date.now() - 10 * 60_000)
    const job: any = await OperationsJob.findOneAndUpdate(
      { runAt: { $lte: new Date() }, $or: [{ status: 'pending' }, { status: 'processing', lockedAt: { $lte: stale } }] },
      { $set: { status: 'processing', lockedAt: new Date() }, $inc: { attempts: 1 } },
      { new: true, sort: { runAt: 1 } },
    )
    if (!job) break
    try {
      await deliver(job)
      await OperationsJob.updateOne({ _id: job._id }, { $set: { status: 'completed', completedAt: new Date(), lastError: '' }, $unset: { lockedAt: 1 } })
      completed += 1
    } catch (error) {
      const final = job.attempts >= job.maxAttempts
      await OperationsJob.updateOne(
        { _id: job._id },
        { $set: { status: final ? 'failed' : 'pending', lastError: error instanceof Error ? error.message.slice(0, 500) : 'Unknown operations error', runAt: new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60_000) }, $unset: { lockedAt: 1 } },
      )
      failed += 1
      logger.error('[Operations queue] job failed', { jobId: job._id.toString(), type: job.type })
    }
  }
  return { completed, failed }
}

const schedulePendingCalendarSync = async (limit = 25) => {
  if (config.calendar.provider_approval_status !== 'approved' || !config.calendar.sync_url || !config.calendar.api_token) return { scheduled: 0 }
  const candidates: any[] = await Viewing.find({
    calendarSyncStatus: { $in: ['pending_provider_approval', 'not_configured'] },
    status: { $in: ['Scheduled', 'Confirmed', 'Rescheduled'] },
    date: { $gte: new Date().toISOString().slice(0, 10) },
  }).select('_id organizationId').limit(limit).lean()
  let scheduled = 0
  for (const viewing of candidates) {
    const exists = await OperationsJob.exists({ organizationId: viewing.organizationId, type: 'calendar_sync', entityId: viewing._id.toString(), status: { $in: ['pending', 'processing'] } })
    if (!exists) {
      await schedule({ organizationId: viewing.organizationId, type: 'calendar_sync', entityId: viewing._id.toString(), runAt: new Date(Date.now() + 1_000) })
      scheduled += 1
    }
  }
  return { scheduled }
}

export const OperationsQueueService = { schedule, cancel, processDue, schedulePendingCalendarSync }
