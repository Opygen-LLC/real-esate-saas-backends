import { Schema, model } from 'mongoose'

const operationsJobSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  type: { type: String, enum: ['task_reminder', 'viewing_reminder', 'calendar_sync'], required: true, index: true },
  entityId: { type: String, required: true, index: true },
  runAt: { type: Date, required: true, index: true },
  payload: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  lockedAt: Date,
  completedAt: Date,
  lastError: { type: String, default: '' },
}, { timestamps: true })
operationsJobSchema.index({ status: 1, runAt: 1 })
operationsJobSchema.index({ organizationId: 1, type: 1, entityId: 1, status: 1 })
export const OperationsJob = model('OperationsJob', operationsJobSchema)
