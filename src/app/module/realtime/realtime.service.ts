import type { Namespace, Server as SocketIOServer } from 'socket.io'
import { logger } from '../../../shared/logger'
import type { DomainRealtimeInput, RealtimeEnvelope } from './realtime.types'

type Runtime = {
  io?: SocketIOServer
  dashboard?: Namespace
  public?: Namespace
}

const runtime: Runtime = {}
const nowEnvelope = (event: Omit<RealtimeEnvelope, 'revision' | 'occurredAt'>): RealtimeEnvelope => ({
  ...event,
  revision: Date.now(),
  occurredAt: new Date().toISOString(),
})

const configure = (io: SocketIOServer, dashboard: Namespace, publicNamespace: Namespace) => {
  runtime.io = io
  runtime.dashboard = dashboard
  runtime.public = publicNamespace
}

const emitOrganization = (organizationId: string, event: Omit<RealtimeEnvelope, 'organizationId' | 'revision' | 'occurredAt'>) => {
  if (!runtime.dashboard || !organizationId) return
  runtime.dashboard.to(`org:${organizationId}`).emit('change', nowEnvelope({ ...event, organizationId }))
}

const emitRole = (role: string, event: Omit<RealtimeEnvelope, 'revision' | 'occurredAt'>) => {
  if (!runtime.dashboard || !role) return
  runtime.dashboard.to(`role:${role}`).emit('change', nowEnvelope(event))
}

const emitUser = (userId: string, event: Omit<RealtimeEnvelope, 'userId' | 'revision' | 'occurredAt'>) => {
  if (!runtime.dashboard || !userId) return
  runtime.dashboard.to(`user:${userId}`).emit('change', nowEnvelope({ ...event, userId }))
}

const emitPublicOrganization = (organizationId: string, event: Omit<RealtimeEnvelope, 'organizationId' | 'revision' | 'occurredAt' | 'publicVisible'>) => {
  if (!runtime.public || !organizationId) return
  runtime.public.to(`public:org:${organizationId}`).emit('change', nowEnvelope({ ...event, organizationId, publicVisible: true }))
}

const actionFromEvent = (eventType: string): string => {
  if (eventType.endsWith('.created') || eventType.endsWith('.scheduled')) return 'created'
  if (eventType.endsWith('.deleted')) return 'deleted'
  if (eventType.includes('status') || eventType.includes('stage_changed')) return 'status_changed'
  if (eventType.includes('assigned')) return 'assigned'
  return 'updated'
}

const fromDomainEvent = (input: DomainRealtimeInput) => {
  const prefix = input.eventType.split('.')[0]
  const entityId = input.aggregateId
  const action = input.eventType === 'lead.converted' ? 'converted' : actionFromEvent(input.eventType)

  const map: Record<string, RealtimeEnvelope['type']> = {
    property: 'property.changed',
    lead: 'lead.changed',
    contact: 'contact.changed',
    task: 'task.changed',
    viewing: 'viewing.changed',
    organization: 'organization.changed',
    website: 'organization.changed',
    team: 'team.changed',
    user: 'team.changed',
  }
  const type = map[prefix] || map[input.aggregateType]
  if (!type) return

  emitOrganization(input.organizationId, { type, action, entityId, eventType: input.eventType })

  // A conversion creates/activates a Contact while the canonical domain event remains lead.converted.
  // Publish a second lightweight cache hint so other open CRM sessions refresh Contacts too.
  if (input.eventType === 'lead.converted' && input.contactId) {
    // Keep one canonical DomainEvent (lead.converted) while publishing explicit
    // cache/realtime hints for every CRM read model changed by conversion.
    emitOrganization(input.organizationId, {
      type: 'contact.changed',
      action: 'created_from_lead',
      entityId: input.contactId,
      eventType: 'contact.created_from_lead',
    })
    const cancelledTaskIds = Array.isArray(input.payload?.cancelledFollowUpTaskIds)
      ? input.payload.cancelledFollowUpTaskIds.filter((value): value is string => typeof value === 'string')
      : []
    for (const taskId of cancelledTaskIds) {
      emitOrganization(input.organizationId, {
        type: 'task.changed',
        action: 'updated',
        entityId: taskId,
        eventType: 'lead.converted',
      })
    }
    emitOrganization(input.organizationId, {
      type: 'dashboard.changed',
      action: 'updated',
      entityId: entityId,
      eventType: 'lead.converted',
    })
    emitOrganization(input.organizationId, {
      type: 'activity.changed',
      action: 'created',
      entityId: entityId,
      eventType: 'lead.converted',
    })
  }

  const publicVisible = input.payload?.publicVisible === true
  if (type === 'property.changed' && publicVisible) {
    emitPublicOrganization(input.organizationId, { type, action, entityId })
  }
  if (type === 'organization.changed' && (prefix === 'website' || input.eventType.startsWith('organization.website_'))) {
    emitPublicOrganization(input.organizationId, { type, action, entityId })
  }
}

const emitNotification = (organizationId: string, userId: string, entityId: string, action: string = 'created') => {
  emitUser(userId, { type: 'notification.changed', action, entityId, organizationId })
}

const emitAuthorizationChanged = (input: { userId: string; organizationId?: string; forceLogout?: boolean; reason?: string }) => {
  emitUser(input.userId, {
    type: 'auth.changed',
    action: 'authorization_changed',
    organizationId: input.organizationId,
    entityId: input.reason,
    forceLogout: Boolean(input.forceLogout),
  })
}

const emitSessionChanged = (input: { userId: string; organizationId?: string; forceLogout?: boolean; reason?: string }) => {
  emitUser(input.userId, {
    type: 'session.changed',
    action: input.forceLogout ? 'revoked' : 'updated',
    organizationId: input.organizationId,
    entityId: input.reason,
    forceLogout: Boolean(input.forceLogout),
  })
}

const disconnectUser = async (userId: string) => {
  if (!runtime.dashboard) return
  try {
    const sockets = await runtime.dashboard.in(`user:${userId}`).fetchSockets()
    sockets.forEach((socket) => socket.disconnect(true))
  } catch (error) {
    logger.warn('realtime_disconnect_user_failed', { userId, error })
  }
}

export const RealtimeService = {
  configure,
  fromDomainEvent,
  emitOrganization,
  emitRole,
  emitUser,
  emitPublicOrganization,
  emitNotification,
  emitAuthorizationChanged,
  emitSessionChanged,
  disconnectUser,
}
