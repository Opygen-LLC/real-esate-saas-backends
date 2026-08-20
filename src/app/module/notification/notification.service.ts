import { isValidObjectId } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { Notification } from './notification.model'
import { RealtimeService } from '../realtime/realtime.service'

type NotificationJobInput = {
  organizationId: string
  userId?: string
  jobId: string
  type: 'task_reminder' | 'viewing_reminder'
  title: string
  body?: string
  entityId: string
  leadId?: string
}

const assertNotificationId = (id: string) => {
  if (!isValidObjectId(id)) throw new ApiError(404, 'Notification not found')
}

const normalizeLimit = (value: number) => Number.isFinite(value)
  ? Math.min(100, Math.max(1, Math.trunc(value)))
  : 20

const isDuplicateKeyError = (error: unknown): boolean => Boolean(
  error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 11000,
)

const createFromJob = async (input: NotificationJobInput) => {
  if (!input.userId) return null

  // updateOne + upsertedId lets worker retries remain idempotent without
  // broadcasting duplicate "created" events for the same reminder job.
  const result = await Notification.updateOne(
    { jobId: input.jobId, userId: input.userId },
    { $setOnInsert: { ...input } },
    { upsert: true, setDefaultsOnInsert: true },
  ).catch((error: unknown) => {
    // Two worker deliveries can race on the unique job/user key. The reminder
    // is already present in that case, so resolve it below instead of failing the job.
    if (isDuplicateKeyError(error)) return null
    throw error
  })
  if (!result) return Notification.findOne({ jobId: input.jobId, userId: input.userId })

  const row = result.upsertedId
    ? await Notification.findById(result.upsertedId)
    : await Notification.findOne({ jobId: input.jobId, userId: input.userId })

  if (row && result.upsertedId) {
    RealtimeService.emitNotification(input.organizationId, input.userId, row._id.toString(), 'created')
  }
  return row
}

const list = async (organizationId: string, userId: string, limit = 20) => Notification.find({
  organizationId,
  userId,
  dismissedAt: null,
})
  .sort({ createdAt: -1, _id: -1 })
  .limit(normalizeLimit(limit))
  .lean()

const markRead = async (organizationId: string, userId: string, id: string) => {
  assertNotificationId(id)
  const row = await Notification.findOneAndUpdate(
    { _id: id, organizationId, userId, dismissedAt: null },
    { $set: { readAt: new Date() } },
    { new: true },
  )
  if (!row) throw new ApiError(404, 'Notification not found')
  RealtimeService.emitNotification(organizationId, userId, row._id.toString(), 'read')
  return row
}

const markAllRead = async (organizationId: string, userId: string) => {
  const result = await Notification.updateMany(
    { organizationId, userId, dismissedAt: null, readAt: null },
    { $set: { readAt: new Date() } },
  )
  if (result.modifiedCount > 0) RealtimeService.emitNotification(organizationId, userId, 'all', 'read')
  return result
}

const dismiss = async (organizationId: string, userId: string, id: string) => {
  assertNotificationId(id)
  const dismissedAt = new Date()
  const row = await Notification.findOneAndUpdate(
    { _id: id, organizationId, userId, dismissedAt: null },
    // A dismissed notification is considered consumed. Keeping readAt makes
    // the retained history semantically accurate without hard-deleting it.
    { $set: { dismissedAt, readAt: dismissedAt } },
    { new: true },
  )
  if (row) {
    RealtimeService.emitNotification(organizationId, userId, row._id.toString(), 'deleted')
    return row
  }

  // DELETE is idempotent for the owning user. This avoids a stale second tab
  // turning an already-completed dismissal into an application error.
  const alreadyDismissed = await Notification.findOne({ _id: id, organizationId, userId, dismissedAt: { $ne: null } })
  if (alreadyDismissed) return alreadyDismissed
  throw new ApiError(404, 'Notification not found')
}

export const NotificationService = { createFromJob, list, markRead, markAllRead, dismiss }
