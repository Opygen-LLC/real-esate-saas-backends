import { Schema, model } from 'mongoose'

const auditEventSchema = new Schema({
  organizationId: { type: String, default: '', index: true }, actorId: { type: String, default: 'system' },
  actorRole: { type: String, default: 'system' }, action: { type: String, required: true, index: true },
  entityType: { type: String, required: true }, entityId: { type: String, default: '' },
  reason: { type: String, default: '' }, metadata: { type: Schema.Types.Mixed, default: {} },
  requestId: { type: String, default: '' }, ip: { type: String, default: '' },
}, { timestamps: true, versionKey: false })

auditEventSchema.index({ organizationId: 1, createdAt: -1 })
export const AuditEvent = model('AuditEvent', auditEventSchema)
