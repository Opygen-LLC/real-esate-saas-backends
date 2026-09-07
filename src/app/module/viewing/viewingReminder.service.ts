import { OperationsJob } from '../operationsQueue/operationsJob.model'
import { NotificationService } from '../notification/notification.service'
import { TransactionalOutbox } from '../domainEvent/transactionalOutbox.service'
import { Viewing } from './viewing.model'
import { viewingTransaction } from './viewingTransaction'
import { isActiveViewingStatus } from './viewingWindow'

/** Fence the worker lease and persist reminder effects exactly once in MongoDB. */
export const deliverViewingReminder = async (job: any) => viewingTransaction(job.organizationId, async (session) => {
  const claimed = await OperationsJob.findOneAndUpdate(
    { _id: job._id, organizationId: job.organizationId, status: 'processing', lockedBy: job.lockedBy, effectsCommittedAt: null },
    { $set: { effectsCommittedAt: new Date() } }, { session, new: true },
  )
  if (!claimed) return { delivered: false }
  const viewing: any = await Viewing.findOne({ _id: job.entityId, organizationId: job.organizationId }).session(session).lean()
  if (!viewing || !isActiveViewingStatus(viewing.status)) return { delivered: false }
  if (job.payload?.scheduleVersion !== undefined && Number(job.payload.scheduleVersion) !== Number(viewing.scheduleVersion || 1)) return { delivered: false }
  // Do not send a catch-up reminder for an appointment that has already started.
  if (Date.parse(`${viewing.date}T${viewing.startTime}:00+06:00`) <= Date.now()) return { delivered: false }
  const userId = viewing.agentId?.toString()
  const notification = await NotificationService.createFromJob({ organizationId: job.organizationId, userId,
    jobId: job._id.toString(), type: 'viewing_reminder', title: `Viewing: ${viewing.clientName}`,
    body: `${viewing.date} at ${viewing.startTime}`, entityId: job.entityId, leadId: viewing.leadId?.toString(),
  }, session)
  await TransactionalOutbox.emit({ organizationId: job.organizationId, aggregateType: 'viewing', aggregateId: job.entityId,
    eventType: 'viewing.reminder_due', leadId: viewing.leadId?.toString(), propertyId: viewing.propertyId?.toString(), actorId: userId,
    payload: { summary: `Viewing reminder for ${viewing.clientName}`, date: viewing.date, startTime: viewing.startTime },
  }, session)
  if (notification && userId) await TransactionalOutbox.queuePublish({ organizationId: job.organizationId,
    aggregateType: 'notification', aggregateId: notification._id.toString(), eventType: 'notification.created',
    actorId: userId, payload: { userId },
  }, session)
  return { delivered: true }
})
