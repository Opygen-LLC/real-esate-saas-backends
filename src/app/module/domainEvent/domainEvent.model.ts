import { Schema, model } from 'mongoose'

const domainEventSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  aggregateType: { type: String, required: true, index: true },
  aggregateId: { type: String, required: true, index: true },
  eventType: { type: String, required: true, index: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User' },
  leadId: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: 'Property' },
  contactId: { type: Schema.Types.ObjectId, ref: 'Contact' },
  payload: { type: Schema.Types.Mixed, default: {} },
  occurredAt: { type: Date, default: Date.now, required: true, index: true },
  requestId: { type: String, default: '' },
}, { timestamps: true })

domainEventSchema.index({ organizationId: 1, leadId: 1, occurredAt: -1 })
domainEventSchema.index({ organizationId: 1, eventType: 1, occurredAt: -1 })
domainEventSchema.index({ organizationId: 1, occurredAt: -1 })
domainEventSchema.index({ organizationId: 1, aggregateType: 1, aggregateId: 1, occurredAt: -1 })

export const DomainEvent = model('DomainEvent', domainEventSchema)
