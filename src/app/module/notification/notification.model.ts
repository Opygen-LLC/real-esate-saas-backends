import { Schema, model } from 'mongoose'

const notificationSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'OperationsJob', required: true },
  type: { type: String, enum: ['task_reminder', 'viewing_reminder'], required: true },
  title: { type: String, required: true, maxlength: 180 },
  body: { type: String, default: '', maxlength: 600 },
  entityId: { type: String, required: true },
  leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
  readAt: Date,
}, { timestamps: true })
notificationSchema.index({ organizationId: 1, userId: 1, createdAt: -1 })
notificationSchema.index({ jobId: 1, userId: 1 }, { unique: true })
export const Notification = model('Notification', notificationSchema)
