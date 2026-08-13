import ApiError from '../../../errors/ApiError'
import { Notification } from './notification.model'

const createFromJob = async (input: { organizationId: string; userId?: string; jobId: string; type: 'task_reminder' | 'viewing_reminder'; title: string; body?: string; entityId: string; leadId?: string }) => {
  if (!input.userId) return null
  return Notification.findOneAndUpdate(
    { jobId: input.jobId, userId: input.userId },
    { $setOnInsert: { ...input } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
}
const list = async (organizationId: string, userId: string, limit = 20) => Notification.find({ organizationId, userId }).sort({ createdAt: -1 }).limit(Math.min(100, Math.max(1, limit))).lean()
const markRead = async (organizationId: string, userId: string, id: string) => {
  const row = await Notification.findOneAndUpdate({ _id: id, organizationId, userId }, { $set: { readAt: new Date() } }, { new: true })
  if (!row) throw new ApiError(404, 'Notification not found')
  return row
}
const markAllRead = async (organizationId: string, userId: string) => Notification.updateMany({ organizationId, userId, readAt: { $exists: false } }, { $set: { readAt: new Date() } })
export const NotificationService = { createFromJob, list, markRead, markAllRead }
