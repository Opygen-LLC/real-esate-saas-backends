import type { ClientSession } from 'mongoose'
import { Activity } from '../activity/activity.model'
import { DomainEvent } from './domainEvent.model'
import { CacheInvalidationService } from './cacheInvalidation.service'
import { RealtimeService } from '../realtime/realtime.service'
import { NextRevalidationService } from '../realtime/nextRevalidation.service'

export type DomainEventInput = {
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

type EmitOptions = {
  session?: ClientSession
  /** Persist the event/activity projection now, but publish cache/realtime side-effects after commit. */
  deferPublish?: boolean
}

const activityProjection: Record<string, { type: string; title: string }> = {
  'lead.created': { type: 'system', title: 'Lead captured' },
  'lead.merged': { type: 'system', title: 'Duplicate lead merged' },
  'lead.stage_changed': { type: 'status_change', title: 'Pipeline stage updated' },
  'lead.assigned': { type: 'system', title: 'Lead assignment updated' },
  'lead.updated': { type: 'note', title: 'Lead details updated' },
  'lead.response_recorded': { type: 'system', title: 'First contact recorded' },
  'lead.converted': { type: 'system', title: 'Lead converted to contact' },
  'lead.follow_up_scheduled': { type: 'system', title: 'Lead follow-up scheduled' },
  'activity.call': { type: 'call', title: 'Call logged' },
  'activity.email': { type: 'email', title: 'Email logged' },
  'activity.whatsapp': { type: 'whatsapp', title: 'WhatsApp interaction' },
  'activity.meeting': { type: 'meeting', title: 'Meeting logged' },
  'activity.note': { type: 'note', title: 'Note added' },
  'activity.offer': { type: 'offer', title: 'Offer activity logged' },
  'contact.created': { type: 'system', title: 'Contact created' },
  'contact.updated': { type: 'system', title: 'Contact details updated' },
  'task.created': { type: 'system', title: 'Task created' },
  'task.updated': { type: 'system', title: 'Task updated' },
  'task.completed': { type: 'system', title: 'Task completed' },
  'task.reminder_due': { type: 'system', title: 'Task reminder due' },
  'viewing.scheduled': { type: 'viewing', title: 'Viewing scheduled' },
  'viewing.updated': { type: 'viewing', title: 'Viewing updated' },
  'viewing.completed': { type: 'viewing', title: 'Viewing completed' },
  'viewing.deleted': { type: 'viewing', title: 'Viewing cancelled' },
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

/**
 * Publish only non-transactional side effects. Lifecycle services call this after
 * their Mongo transaction commits so websocket/cache consumers never observe
 * uncommitted state.
 */
const publish = async (input: DomainEventInput) => {
  await CacheInvalidationService.fromEvent(input).catch(() => undefined)
  RealtimeService.fromDomainEvent(input)
  await NextRevalidationService.trigger({
    organizationId: input.organizationId,
    eventType: input.eventType,
    publicVisible: input.payload?.publicVisible === true,
    tenantIdentifier: typeof input.payload?.tenantIdentifier === 'string' ? input.payload.tenantIdentifier : undefined,
    tenantIdentifiers: Array.isArray(input.payload?.tenantIdentifiers)
      ? input.payload.tenantIdentifiers.filter((value): value is string => typeof value === 'string')
      : undefined,
  })
}

const emit = async (input: DomainEventInput, options: EmitOptions = {}) => {
  const eventPayload = { ...input, payload: input.payload || {}, occurredAt: new Date() }
  const event = options.session
    ? (await DomainEvent.create([eventPayload], { session: options.session }))[0]
    : await DomainEvent.create(eventPayload)

  const projection = activityProjection[input.eventType]
  // CRM history is Activity-backed. Project events linked to either a Lead or Contact;
  // Contact-only notes/events must not disappear simply because they have no source Lead.
  if (projection && (input.leadId || input.contactId)) {
    const activityPayload = {
      organizationId: input.organizationId,
      leadId: input.leadId,
      propertyId: input.propertyId,
      contactId: input.contactId,
      agentId: input.actorId,
      type: projection.type,
      title: projection.title,
      content: stringify(input.payload),
      metadata: { domainEventId: event._id, eventType: input.eventType },
    }
    if (options.session) await Activity.create([activityPayload], { session: options.session })
    else await Activity.create(activityPayload)
  }

  if (!options.deferPublish) await publish(input)
  return event
}

export const DomainEventService = { emit, publish }
