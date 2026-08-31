import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { Contact } from '../contact/contact.model'
import { visibleContactRelationshipFilter } from '../contact/contactRelationship.contract'
import {
  crmMutationOwnerFilter,
  crmReadOwnerFilter,
  type CrmAccessContext,
} from '../crm/crmAccess'
import { DomainEvent } from '../domainEvent/domainEvent.model'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { LeadLifecycleService } from '../lead/leadLifecycle.service'
import { LeadEntitlementService } from '../lead/leadEntitlement.service'
import { Lead } from '../lead/lead.model'
import { userRefPopulate } from '../user/userProfile.service'
import { TenantReferenceService } from '../../shared/tenantReference.service'
import {
  CrmHistoryEntry,
  CrmHistoryKind,
  IActivity,
} from './activity.interface'
import { Activity } from './activity.model'

const USER_LOGGABLE_ACTIVITY_TYPES = new Set(['call', 'email', 'whatsapp', 'meeting', 'note', 'offer'])
const CONTACT_ACTIVITY_TYPES = new Set(['call', 'email', 'whatsapp', 'meeting'])

const requiredActor = (actorId?: string): string => {
  if (!actorId) throw new ApiError(403, 'Authenticated CRM user is required')
  return actorId
}

const normalizedNoteContent = (content: unknown): string => {
  const note = String(content || '').trim()
  if (!note) throw new ApiError(400, 'Note content is required')
  if (note.length > 10000) throw new ApiError(400, 'Note content cannot exceed 10000 characters')
  return note
}

const getProjectedActivity = async (organizationId: string, domainEventId: unknown): Promise<IActivity> => {
  const activity: any = await Activity.findOne({ organizationId, 'metadata.domainEventId': domainEventId })
    .populate(userRefPopulate('agentId', 'name email userRole', { organizationId }))
  if (!activity) throw new ApiError(500, 'CRM history projection was not created')
  return activity
}

/**
 * Backward-compatible interaction logging endpoint. Notes are still Activity records,
 * while the dedicated /lead/:id/notes and /contact/:id/notes endpoints provide the
 * append-only note contract used by the CRM detail views.
 */
const createActivity = async (
  organizationId: string,
  payload: Partial<IActivity>,
  access?: CrmAccessContext,
): Promise<IActivity> => {
  if (!payload.leadId) throw new ApiError(400, 'leadId is required for CRM activity')
  const type = String(payload.type || 'note')
  if (!USER_LOGGABLE_ACTIVITY_TYPES.has(type)) throw new ApiError(400, 'Unsupported CRM activity type')

  const visibleLead = await Lead.exists({
    _id: payload.leadId,
    organizationId,
    ...crmMutationOwnerFilter('assignedAgent', access),
  })
  if (!visibleLead) throw new ApiError(404, 'Lead not found')
  await LeadEntitlementService.assertLeadAccessible(organizationId, String(payload.leadId))

  const actorId = payload.agentId ? String(payload.agentId) : undefined
  if (actorId) await TenantReferenceService.assertUserBelongsToOrganization(organizationId, actorId)
  if (payload.propertyId) await TenantReferenceService.assertPropertyBelongsToOrganization(organizationId, payload.propertyId)
  if (payload.contactId) await TenantReferenceService.assertContactBelongsToOrganization(organizationId, payload.contactId)
  const eventType = `activity.${type}`
  const event: any = await DomainEventService.emit({
    organizationId,
    aggregateType: 'lead',
    aggregateId: String(payload.leadId),
    eventType,
    leadId: String(payload.leadId),
    propertyId: payload.propertyId ? String(payload.propertyId) : undefined,
    contactId: payload.contactId ? String(payload.contactId) : undefined,
    actorId,
    payload: {
      summary: payload.content || payload.title || 'CRM activity',
      title: payload.title || '',
      ...(payload.metadata || {}),
    },
  })

  if (CONTACT_ACTIVITY_TYPES.has(type)) {
    await LeadLifecycleService.recordContact(organizationId, String(payload.leadId), {
      actorId,
      channel: type as 'call' | 'email' | 'whatsapp' | 'meeting',
      access,
    })
  }

  return getProjectedActivity(organizationId, event._id)
}

const createLeadNote = async (
  organizationId: string,
  leadId: string,
  content: string,
  actorId?: string,
  access?: CrmAccessContext,
): Promise<IActivity> => {
  const authorId = requiredActor(actorId)
  const note = normalizedNoteContent(content)
  const lead: any = await Lead.findOne({
    _id: leadId,
    organizationId,
    ...crmMutationOwnerFilter('assignedAgent', access),
  }).select('_id convertedContactId')
  if (!lead) throw new ApiError(404, 'Lead not found')
  await LeadEntitlementService.assertLeadAccessible(organizationId, leadId)

  const event: any = await DomainEventService.emit({
    organizationId,
    aggregateType: 'lead',
    aggregateId: leadId,
    eventType: 'activity.note',
    leadId,
    contactId: lead.convertedContactId ? String(lead.convertedContactId) : undefined,
    actorId: authorId,
    payload: { summary: note, note: true },
  })
  return getProjectedActivity(organizationId, event._id)
}

const createLeadSystemNote = async (
  organizationId: string,
  leadId: string,
  content: string,
  systemActorLabel = 'System',
): Promise<IActivity> => {
  const note = normalizedNoteContent(content)
  const lead: any = await Lead.findOne({ _id: leadId, organizationId }).select('_id convertedContactId')
  if (!lead) throw new ApiError(404, 'Lead not found')
  const event: any = await DomainEventService.emit({
    organizationId,
    aggregateType: 'lead',
    aggregateId: leadId,
    eventType: 'activity.note',
    leadId,
    contactId: lead.convertedContactId ? String(lead.convertedContactId) : undefined,
    payload: { summary: note, note: true, systemActorLabel },
  })
  return getProjectedActivity(organizationId, event._id)
}

const createContactNote = async (
  organizationId: string,
  contactId: string,
  content: string,
  actorId?: string,
  access?: CrmAccessContext,
): Promise<IActivity> => {
  const authorId = requiredActor(actorId)
  const note = normalizedNoteContent(content)
  const contact: any = await Contact.findOne({
    _id: contactId,
    organizationId,
    ...crmMutationOwnerFilter('assignedTo', access),
    ...visibleContactRelationshipFilter,
  }).select('_id sourceLeadId')
  if (!contact) throw new ApiError(404, 'Contact not found')

  const event: any = await DomainEventService.emit({
    organizationId,
    aggregateType: 'contact',
    aggregateId: contactId,
    eventType: 'activity.note',
    // Preserve the original Lead relationship so Contact history and archived Lead
    // history can both resolve the same append-only interaction record.
    leadId: contact.sourceLeadId ? String(contact.sourceLeadId) : undefined,
    contactId,
    actorId: authorId,
    payload: { summary: note, note: true },
  })
  return getProjectedActivity(organizationId, event._id)
}

const getActivitiesByLead = async (
  organizationId: string,
  leadId: string,
  paginationOptions: IPaginationOptions,
  access?: CrmAccessContext,
): Promise<IGenericResponse<IActivity[]>> => {
  const visibleLead = await Lead.exists({
    _id: leadId,
    organizationId,
    ...crmReadOwnerFilter('assignedAgent', access),
  })
  if (!visibleLead) throw new ApiError(404, 'Lead not found')
  await LeadEntitlementService.assertLeadAccessible(organizationId, leadId)
  const { page, limit, skip } = paginationHelper.calculatePagination(paginationOptions)
  const [result, total] = await Promise.all([
    Activity.find({ organizationId, leadId })
      .populate(userRefPopulate('agentId', 'name email userRole', { organizationId }))
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit),
    Activity.countDocuments({ organizationId, leadId }),
  ])
  return { meta: { page, limit, total }, data: result }
}

const historyKind = (eventType: string, activityType: string): CrmHistoryKind => {
  if (eventType === 'lead.created') return 'lead_created'
  if (eventType === 'lead.assigned') return 'assignment'
  if (eventType === 'lead.stage_changed') return 'status_change'
  if (eventType === 'lead.follow_up_scheduled') return 'follow_up'
  if (eventType === 'lead.converted') return 'conversion'
  if (eventType.startsWith('task.')) return 'task'
  if (eventType.startsWith('viewing.')) return 'viewing'
  if (eventType.startsWith('sms.')) return 'sms'
  if (eventType.startsWith('contact.')) return 'contact'
  if (eventType.includes('offer') || activityType === 'offer') return 'offer'
  if (eventType === 'activity.note' || activityType === 'note') return 'note'
  if (eventType === 'activity.call' || activityType === 'call') return 'call'
  if (eventType === 'activity.whatsapp' || activityType === 'whatsapp') return 'whatsapp'
  if (eventType === 'activity.email' || activityType === 'email') return 'email'
  if (eventType === 'activity.meeting' || activityType === 'meeting') return 'meeting'
  if (activityType === 'status_change') return 'status_change'
  if (activityType === 'viewing') return 'viewing'
  return 'system'
}

const systemAuthorName = (activity: any, event: any): string => {
  const metadata = activity?.metadata || {}
  if (typeof metadata.systemActorLabel === 'string' && metadata.systemActorLabel.trim()) {
    return metadata.systemActorLabel.trim()
  }
  if (typeof event?.payload?.systemActorLabel === 'string' && event.payload.systemActorLabel.trim()) return event.payload.systemActorLabel.trim()
  if (event?.payload?.changedBy === 'system') return 'System'
  return 'Broker System'
}

const historyAuthor = (activity: any, event: any) => {
  const user = activity.agentId && typeof activity.agentId === 'object' ? activity.agentId : undefined
  if (user?._id) {
    return {
      authorId: String(user._id),
      author: {
        _id: String(user._id),
        name: String(user.name || 'Former/removed CRM user'),
        ...(user.email ? { email: String(user.email) } : {}),
        ...(user.userRole ? { userRole: String(user.userRole) } : {}),
        ...(user.profile?.profileImgURL ? { profileImgURL: String(user.profile.profileImgURL) } : {}),
        type: 'user' as const,
      },
    }
  }
  if (event?.actorId) {
    return {
      authorId: String(event.actorId),
      author: { _id: String(event.actorId), name: 'Former/removed CRM user', type: 'user' as const },
    }
  }
  return {
    authorId: undefined,
    author: { name: systemAuthorName(activity, event), type: 'system' as const },
  }
}

const historyEntry = (activity: any, event?: any): CrmHistoryEntry => {
  const activityMetadata = activity.metadata?.toObject?.() || activity.metadata || {}
  const { domainEventId: _domainEventId, ...safeActivityMetadata } = activityMetadata
  const eventPayload = event?.payload && typeof event.payload === 'object' ? event.payload : {}
  const eventType = String(event?.eventType || activityMetadata.eventType || (activityMetadata.legacySource ? 'legacy.note' : `activity.${activity.type}`))
  const { authorId, author } = historyAuthor(activity, event)

  const kind = eventType === 'lead.stage_changed' && String((eventPayload as any).newStatus || '') === 'OfferMade'
    ? 'offer'
    : historyKind(eventType, String(activity.type || 'system'))

  return {
    _id: String(activity._id),
    kind,
    eventType,
    title: String(activity.title || 'CRM activity'),
    content: String(activity.content || eventPayload.summary || ''),
    ...(authorId ? { authorId } : {}),
    author,
    ...(activity.leadId ? { leadId: String(activity.leadId) } : {}),
    ...(activity.contactId ? { contactId: String(activity.contactId) } : {}),
    ...(activity.propertyId ? { propertyId: String(activity.propertyId) } : {}),
    details: { ...safeActivityMetadata, ...eventPayload },
    createdAt: activity.createdAt || event?.occurredAt || new Date(),
  }
}

const getHistoryPage = async (
  organizationId: string,
  where: Record<string, unknown>,
  paginationOptions: IPaginationOptions,
): Promise<IGenericResponse<CrmHistoryEntry[]>> => {
  const { page, limit, skip } = paginationHelper.calculatePagination(paginationOptions)
  const [activities, total] = await Promise.all([
    Activity.find({ organizationId, ...where })
      .populate(userRefPopulate('agentId', 'name email userRole', { organizationId }))
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit),
    Activity.countDocuments({ organizationId, ...where }),
  ])

  const eventIds = activities
    .map((activity: any) => activity.metadata?.domainEventId)
    .filter(Boolean)
  const events = eventIds.length
    ? await DomainEvent.find({ organizationId, _id: { $in: eventIds } })
        .select('_id eventType payload occurredAt actorId')
        .lean()
    : []
  const eventsById = new Map(events.map((event: any) => [String(event._id), event]))
  const data = activities.map((activity: any) => historyEntry(
    activity,
    activity.metadata?.domainEventId ? eventsById.get(String(activity.metadata.domainEventId)) : undefined,
  ))

  return { meta: { page, limit, total }, data }
}

const getLeadHistory = async (
  organizationId: string,
  leadId: string,
  paginationOptions: IPaginationOptions,
  access?: CrmAccessContext,
): Promise<IGenericResponse<CrmHistoryEntry[]>> => {
  const visibleLead = await Lead.exists({
    _id: leadId,
    organizationId,
    ...crmReadOwnerFilter('assignedAgent', access),
  })
  if (!visibleLead) throw new ApiError(404, 'Lead not found')
  await LeadEntitlementService.assertLeadAccessible(organizationId, leadId)
  return getHistoryPage(organizationId, { leadId }, paginationOptions)
}

const getContactHistory = async (
  organizationId: string,
  contactId: string,
  paginationOptions: IPaginationOptions,
  access?: CrmAccessContext,
): Promise<IGenericResponse<CrmHistoryEntry[]>> => {
  const contact: any = await Contact.findOne({
    _id: contactId,
    organizationId,
    ...crmReadOwnerFilter('assignedTo', access),
    ...visibleContactRelationshipFilter,
  }).select('_id sourceLeadId')
  if (!contact) throw new ApiError(404, 'Contact not found')

  const relationshipFilters: Record<string, unknown>[] = [{ contactId: contact._id }]
  if (contact.sourceLeadId) relationshipFilters.push({ leadId: contact.sourceLeadId })
  return getHistoryPage(organizationId, { $or: relationshipFilters }, paginationOptions)
}

export const ActivityService = {
  createActivity,
  createLeadNote,
  createLeadSystemNote,
  createContactNote,
  getActivitiesByLead,
  getLeadHistory,
  getContactHistory,
}
