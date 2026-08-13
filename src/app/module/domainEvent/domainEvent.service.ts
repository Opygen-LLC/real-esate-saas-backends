import { Activity } from '../activity/activity.model'
import { DomainEvent } from './domainEvent.model'

type EmitInput = {
  organizationId: string
  aggregateType: string
  aggregateId: string
  eventType: string
  actorId?: string
  leadId?: string
  propertyId?: string
  contactId?: string
  requestId?: string
  payload?: Record<string, unknown>
}

const activityProjection: Record<string, { type: string; title: string }> = {
  'lead.created': { type: 'system', title: 'Lead captured' },
  'lead.merged': { type: 'system', title: 'Duplicate lead merged' },
  'lead.stage_changed': { type: 'status_change', title: 'Pipeline stage updated' },
  'lead.assigned': { type: 'system', title: 'Lead assignment updated' },
  'lead.updated': { type: 'note', title: 'Lead details updated' },
  'lead.response_recorded': { type: 'call', title: 'First response recorded' },
  'activity.call': { type: 'call', title: 'Call logged' },
  'activity.email': { type: 'email', title: 'Email logged' },
  'activity.whatsapp': { type: 'whatsapp', title: 'WhatsApp interaction' },
  'activity.meeting': { type: 'meeting', title: 'Meeting logged' },
  'activity.note': { type: 'note', title: 'Note added' },
  'task.created': { type: 'system', title: 'Task created' },
  'task.updated': { type: 'system', title: 'Task updated' },
  'task.completed': { type: 'system', title: 'Task completed' },
  'task.reminder_due': { type: 'system', title: 'Task reminder due' },
  'viewing.scheduled': { type: 'viewing', title: 'Viewing scheduled' },
  'viewing.updated': { type: 'viewing', title: 'Viewing updated' },
  'viewing.completed': { type: 'viewing', title: 'Viewing completed' },
  'viewing.reminder_due': { type: 'viewing', title: 'Viewing reminder due' },
  'sms.sent': { type: 'system', title: 'SMS sent' },
  'sms.delivered': { type: 'system', title: 'SMS delivered' },
}

const stringify = (payload: Record<string, unknown> = {}): string => {
  if (typeof payload.summary === 'string') return payload.summary
  const safe = Object.entries(payload)
    .filter(([key]) => !['raw', 'token', 'accessToken'].includes(key))
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
  return safe.join(' · ')
}

const emit = async (input: EmitInput) => {
  const event = await DomainEvent.create({ ...input, payload: input.payload || {}, occurredAt: new Date() })
  const projection = activityProjection[input.eventType]
  if (projection && input.leadId) {
    await Activity.create({
      organizationId: input.organizationId,
      leadId: input.leadId,
      propertyId: input.propertyId,
      contactId: input.contactId,
      agentId: input.actorId,
      type: projection.type,
      title: projection.title,
      content: stringify(input.payload),
      metadata: { domainEventId: event._id, eventType: input.eventType },
    })
  }
  return event
}

export const DomainEventService = { emit }
