import ApiError from '../../../errors/ApiError'
import { Notification } from './notification.model'
import { RealtimeService } from '../realtime/realtime.service'

const createFromJob = async (input: { organizationId: string; userId?: string; jobId: string; type: 'task_reminder' | 'viewing_reminder'; title: string; body?: string; entityId: string; leadId?: string }) => {
  if (!input.userId) return null
  const row = await Notification.findOneAndUpdate(
    { jobId: input.jobId, userId: input.userId },
    { $setOnInsert: { ...input } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  if (row) RealtimeService.emitNotification(input.organizationId, input.userId, row._id.toString(), 'created')
  return row
}
const list = async (organizationId: string, userId: string, limit = 20) => Notification.find({ organizationId, userId }).sort({ createdAt: -1 }).limit(Math.min(100, Math.max(1, limit))).lean()
const markRead = async (organizationId: string, userId: string, id: string) => {
  const row = await Notification.findOneAndUpdate({ _id: id, organizationId, userId }, { $set: { readAt: new Date() } }, { new: true })
  if (!row) throw new ApiError(404, 'Notification not found')
  RealtimeService.emitNotification(organizationId, userId, row._id.toString(), 'read')
  return row
}
const markAllRead = async (organizationId: string, userId: string) => {
  const result = await Notification.updateMany({ organizationId, userId, readAt: { $exists: false } }, { $set: { readAt: new Date() } })
  RealtimeService.emitNotification(organizationId, userId, 'all', 'read')
  return result
}
export const NotificationService = { createFromJob, list, markRead, markAllRead }
