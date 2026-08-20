export type RealtimeChannelEvent =
  | 'property.changed'
  | 'lead.changed'
  | 'contact.changed'
  | 'dashboard.changed'
  | 'activity.changed'
  | 'notification.changed'
  | 'task.changed'
  | 'viewing.changed'
  | 'team.changed'
  | 'auth.changed'
  | 'session.changed'
  | 'organization.changed'
  | 'subscription.changed'
  | 'platform.notification.changed'

export type RealtimeAction = 'created' | 'updated' | 'deleted' | 'status_changed' | 'assigned' | 'read' | 'resync' | 'authorization_changed' | 'revoked' | 'confirmed'

export interface RealtimeEnvelope {
  type: RealtimeChannelEvent
  action: RealtimeAction | string
  organizationId?: string
  entityId?: string
  eventType?: string
  userId?: string
  revision: number
  occurredAt: string
  publicVisible?: boolean
  forceLogout?: boolean
  /** Sanitized event details only. Never include payment references, notes, amounts, or other sensitive billing data. */
  payload?: Record<string, unknown>
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
