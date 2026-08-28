import { Schema, model } from 'mongoose'

export const OPERATIONS_JOB_TYPES = [
  'task_reminder', 'viewing_reminder', 'calendar_sync',
  'sms_send', 'meta_capi', 'domain_verify', 'asset_finalize', 'support_email',
] as const

export type OperationsJobType = typeof OPERATIONS_JOB_TYPES[number]

const operationsJobSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  type: { type: String, enum: OPERATIONS_JOB_TYPES, required: true, index: true },
  entityId: { type: String, required: true, index: true },
  runAt: { type: Date, required: true, index: true },
  payload: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  lockedAt: Date,
  lockedBy: { type: String, default: '' },
  completedAt: Date,
  lastError: { type: String, default: '' },
  accessDeferredAt: { type: Date, default: null, index: true },
}, { timestamps: true })
operationsJobSchema.index({ status: 1, accessDeferredAt: 1, runAt: 1 })
operationsJobSchema.index({ organizationId: 1, type: 1, entityId: 1, status: 1 })
operationsJobSchema.index({ status: 1, lockedAt: 1 })
export const OperationsJob = model('OperationsJob', operationsJobSchema)
