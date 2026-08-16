export type RealtimeChannelEvent =
  | 'property.changed'
  | 'lead.changed'
  | 'notification.changed'
  | 'task.changed'
  | 'viewing.changed'
  | 'team.changed'
  | 'auth.changed'
  | 'session.changed'
  | 'organization.changed'

export type RealtimeAction = 'created' | 'updated' | 'deleted' | 'status_changed' | 'assigned' | 'read' | 'resync' | 'authorization_changed' | 'revoked'

export interface RealtimeEnvelope {
  type: RealtimeChannelEvent
  action: RealtimeAction | string
  organizationId?: string
  entityId?: string
  userId?: string
  revision: number
  occurredAt: string
  publicVisible?: boolean
  forceLogout?: boolean
}

export interface DomainRealtimeInput {
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
