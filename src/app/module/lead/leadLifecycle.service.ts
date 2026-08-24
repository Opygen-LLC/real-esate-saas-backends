import mongoose, { type ClientSession } from 'mongoose'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { logger } from '../../../shared/logger'
import { mongoSupportsTransactions } from '../../db/mongoCapabilities'
import { Contact } from '../contact/contact.model'
import { CONTACT_RELATIONSHIP_STATE } from '../contact/contactRelationship.contract'
import { CrmService } from '../crm/crm.service'
import { canAssignLeadTo, crmMutationOwnerFilter, type CrmAccessContext } from '../crm/crmAccess'
import { CrmAssignableMemberService } from '../crm/crmAssignableMember.service'
import { DomainEventService, type DomainEventInput } from '../domainEvent/domainEvent.service'
import { TaskService } from '../task/task.service'
import { Lead } from './lead.model'
import { LeadEntitlementService } from './leadEntitlement.service'
import {
  LEAD_CONVERSION_STATUS,
  LEAD_STATUS,
  normalizeLeadStatus,
  type LeadStatus,
} from './leadStatus.contract'

type ContactChannel = 'call' | 'whatsapp' | 'email' | 'meeting' | 'sms' | 'manual'

type LifecycleEffects = {
  events: DomainEventInput[]
  cancelTaskReminderIds: string[]
  refreshTaskReminderIds: string[]
}

export type LeadLifecycleResult = {
  lead: any
  contact: null | {
    _id: string
    name: string
    phone: string
    email?: string
  }
}

const requireLeadStatus = (value: unknown): LeadStatus => {
  const status = normalizeLeadStatus(value)
  if (!status) throw new ApiError(400, `Unsupported lead status: ${String(value || '')}`)
  return status
}

const queryWithSession = <T extends { session: (session: ClientSession) => T }>(query: T, session?: ClientSession): T =>
  session ? query.session(session) : query

const emitLifecycleEvent = async (
  input: DomainEventInput,
  session: ClientSession | undefined,
  effects: LifecycleEffects,
) => {
  await DomainEventService.emit(input, session ? { session, deferPublish: true } : undefined)
  if (session) effects.events.push(input)
}

const emptyEffects = (): LifecycleEffects => ({ events: [], cancelTaskReminderIds: [], refreshTaskReminderIds: [] })

const runLifecycleMutation = async <T>(
  organizationId: string,
  work: (session: ClientSession | undefined, effects: LifecycleEffects) => Promise<T>,
): Promise<T> => {
  let effects = emptyEffects()
  const supportsTransactions = await mongoSupportsTransactions()
  let result: T | undefined

  if (supportsTransactions) {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        // withTransaction may retry its callback. Never reuse a side-effect buffer
        // from an aborted attempt or we could publish duplicate realtime events.
        const attemptEffects = emptyEffects()
        const attemptResult = await work(session, attemptEffects)
        result = attemptResult
        effects = attemptEffects
      })
    } finally {
      await session.endSession()
    }
  } else {
    if (config.isProduction) {
      throw new ApiError(503, 'Lead lifecycle mutations require a MongoDB replica set or mongos in production')
    }
    result = await work(undefined, effects)
  }

  if (result === undefined) throw new ApiError(500, 'Lead lifecycle mutation did not complete')

  // The database mutation is already committed here. Secondary cache/realtime/queue
  // delivery must not make the caller think the commit failed.
  for (const event of effects.events) {
    try {
      await DomainEventService.publish(event)
    } catch (error) {
      logger.warn('lead_lifecycle_post_commit_publish_failed', { organizationId, eventType: event.eventType, error })
    }
  }
  if (effects.cancelTaskReminderIds.length) {
    try {
      await TaskService.cancelTaskReminders(organizationId, effects.cancelTaskReminderIds)
    } catch (error) {
      logger.warn('lead_lifecycle_post_commit_reminder_cancel_failed', { organizationId, taskIds: effects.cancelTaskReminderIds, error })
    }
  }
  if (effects.refreshTaskReminderIds.length) {
    try {
      await TaskService.refreshTaskReminders(organizationId, effects.refreshTaskReminderIds)
    } catch (error) {
      logger.warn('lead_lifecycle_post_commit_reminder_refresh_failed', { organizationId, taskIds: effects.refreshTaskReminderIds, error })
    }
  }
  return result
}

const loadMutableLead = async (
  organizationId: string,
  leadId: string,
  access?: CrmAccessContext,
  session?: ClientSession,
) => {
  const query = Lead.findOne({
    _id: leadId,
    organizationId,
    ...crmMutationOwnerFilter('assignedAgent', access),
  })
  const lead: any = await queryWithSession(query as any, session)
  if (!lead) throw new ApiError(404, 'Lead not found')
  // Defense in depth for lifecycle callers that bypass LeadService. When called
  // inside a transaction this re-checks the persisted lock state in the same session.
  await LeadEntitlementService.assertLeadAccessible(organizationId, leadId, session)
  return lead
}

const validateConfiguredStage = async (organizationId: string, status: LeadStatus, lostReason?: string) => {
  const configDoc: any = await CrmService.getConfig(organizationId)
  const stage = (configDoc.pipelineStages || []).find((item: any) => item.key === status)
  if (!stage) throw new ApiError(400, 'Pipeline stage is not configured for this agency')
  if (stage.lost && (!lostReason || !(configDoc.lostReasons || []).includes(lostReason))) {
    throw new ApiError(400, 'A configured lost reason is required')
  }
  return { stage, configDoc }
}

const statusEvent = (
  organizationId: string,
  lead: any,
  previousStatus: string,
  newStatus: LeadStatus,
  actorId: string | undefined,
  changedAt: Date,
  reason: string,
  lostReason?: string,
): DomainEventInput => ({
  organizationId,
  aggregateType: 'lead',
  aggregateId: String(lead._id),
  eventType: 'lead.stage_changed',
  leadId: String(lead._id),
  contactId: lead.convertedContactId ? String(lead.convertedContactId) : undefined,
  actorId,
  payload: {
    summary: `Stage changed from ${previousStatus} to ${newStatus}${lostReason ? ` · ${lostReason}` : ''}`,
    previousStatus,
    newStatus,
    // Legacy payload key retained for existing analytics/projections.
    leadStatus: newStatus,
    changedBy: actorId || 'system',
    changedAt: changedAt.toISOString(),
    reason,
    lostReason: lostReason || '',
  },
})

const applyStatusChange = async (input: {
  organizationId: string
  lead: any
  newStatus: LeadStatus
  actorId?: string
  lostReason?: string
  reason?: string
  session?: ClientSession
  effects: LifecycleEffects
}) => {
  const previousStatus = normalizeLeadStatus(input.lead.leadStatus) || String(input.lead.leadStatus || LEAD_STATUS.NEW)
  const { stage } = await validateConfiguredStage(input.organizationId, input.newStatus, input.lostReason)
  if (input.newStatus === LEAD_STATUS.FOLLOW_UP_SCHEDULED && !input.lead.followUpDate) {
    throw new ApiError(400, 'Follow-up Scheduled requires a follow-up date. Schedule the follow-up first.')
  }
  const changedAt = new Date()
  const lostReason = stage.lost ? input.lostReason || '' : ''
  const reason = input.reason?.trim() || (lostReason ? `Lost reason: ${lostReason}` : 'Pipeline status updated')

  if (previousStatus === input.newStatus && String(input.lead.lostReason || '') === lostReason) return false

  input.lead.leadStatus = input.newStatus
  input.lead.lostReason = lostReason
  if (input.actorId) input.lead.updatedBy = input.actorId

  // A direct manual transition to Contacted is itself a recorded first contact.
  if (input.newStatus === LEAD_STATUS.CONTACTED) {
    if (!input.lead.firstContactedAt) input.lead.firstContactedAt = changedAt
    if (!input.lead.firstResponseAt) {
      input.lead.firstResponseAt = changedAt
      if (input.lead.responseDueAt && input.lead.responseDueAt < changedAt && !input.lead.slaBreachedAt) {
        input.lead.slaBreachedAt = changedAt
      }
    }
    input.lead.lastContact = changedAt
  }

  await input.lead.save(input.session ? { session: input.session } : undefined)
  await emitLifecycleEvent(
    statusEvent(
      input.organizationId,
      input.lead,
      previousStatus,
      input.newStatus,
      input.actorId,
      changedAt,
      reason,
      lostReason,
    ),
    input.session,
    input.effects,
  )
  return true
}

const contactIdentity = (contact: any) => ({
  _id: String(contact._id),
  name: String(contact.name || ''),
  phone: String(contact.phone || ''),
  ...(contact.email ? { email: String(contact.email) } : {}),
})

const findSafeConversionContact = async (lead: any, session?: ClientSession) => {
  const organizationId = String(lead.organizationId)
  const explicitIds = [lead.convertedContactId, lead.contactId].filter(Boolean)
  if (explicitIds.length) {
    const explicitQuery = Contact.findOne({ _id: { $in: explicitIds }, organizationId })
    const explicit: any = await queryWithSession(explicitQuery as any, session)
    if (explicit) {
      if (explicit.sourceLeadId && String(explicit.sourceLeadId) !== String(lead._id)) {
        throw new ApiError(409, 'The linked Contact already belongs to another Lead')
      }
      return explicit
    }
  }

  const sourceQuery = Contact.findOne({ organizationId, sourceLeadId: lead._id })
  const bySource: any = await queryWithSession(sourceQuery as any, session)
  if (bySource) return bySource

  const identity: Record<string, unknown>[] = []
  if (lead.normalizedPhone) identity.push({ normalizedPhone: lead.normalizedPhone })
  if (lead.normalizedEmail) identity.push({ normalizedEmail: lead.normalizedEmail })
  if (!identity.length) return null

  let candidatesQuery = Contact.find({ organizationId, $or: identity }).limit(3)
  if (session) candidatesQuery = candidatesQuery.session(session)
  const candidates: any[] = await candidatesQuery
  const conflicting = candidates.filter((contact) => contact.sourceLeadId && String(contact.sourceLeadId) !== String(lead._id))
  if (conflicting.length) {
    throw new ApiError(409, 'A matching Contact is already linked to another Lead. Resolve the duplicate before conversion.')
  }
  if (candidates.length > 1) {
    throw new ApiError(409, 'Multiple matching Contacts exist. Resolve duplicate Contacts before converting this Lead.')
  }
  return candidates[0] || null
}

const convertToContact = async (
  organizationId: string,
  leadId: string,
  actorId?: string,
  access?: CrmAccessContext,
  reason = 'Lead won / converted',
): Promise<LeadLifecycleResult> => {
  // Keep direct service callers on the same configured pipeline contract as changeStatus().
  await validateConfiguredStage(organizationId, LEAD_CONVERSION_STATUS)
  return runLifecycleMutation(organizationId, async (session, effects) => {
  const lead: any = await loadMutableLead(organizationId, leadId, access, session)
  const previousStatus = normalizeLeadStatus(lead.leadStatus) || String(lead.leadStatus || LEAD_STATUS.NEW)
  const changedAt = new Date()

  let contact: any = await findSafeConversionContact(lead, session)
  if (lead.isConverted && contact) {
    return { lead, contact: contactIdentity(contact) }
  }

  const conversionPatch: any = {
    organizationId,
    name: lead.name,
    phone: lead.phone,
    normalizedPhone: lead.normalizedPhone,
    email: lead.email || undefined,
    normalizedEmail: lead.normalizedEmail || '',
    relationshipState: CONTACT_RELATIONSHIP_STATE.ACTIVE,
    sourceLeadId: lead._id,
    assignedTo: lead.assignedAgent || undefined,
    source: lead.source,
    propertyInterest: lead.propertyInterest || [],
    followUpDate: lead.followUpDate || undefined,
    convertedAt: lead.convertedAt || changedAt,
    convertedBy: lead.convertedBy || actorId || undefined,
    updatedBy: actorId || undefined,
    statusAtConversion: LEAD_CONVERSION_STATUS,
  }

  if (contact) {
    Object.assign(contact, conversionPatch)
    if (!contact.createdBy && actorId) contact.createdBy = actorId
    await contact.save(session ? { session } : undefined)
  } else {
    const update: Record<string, unknown> = { $set: conversionPatch }
    if (actorId) update.$setOnInsert = { createdBy: actorId }
    contact = await Contact.findOneAndUpdate(
      { organizationId, sourceLeadId: lead._id },
      update,
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        ...(session ? { session } : {}),
      },
    )
    if (!contact) throw new ApiError(500, 'Lead conversion could not create the Contact')
  }

  lead.leadStatus = LEAD_CONVERSION_STATUS
  lead.lostReason = ''
  lead.isConverted = true
  lead.convertedAt = lead.convertedAt || changedAt
  lead.convertedBy = lead.convertedBy || actorId || undefined
  lead.convertedContactId = contact._id
  // Temporary backward-compatible alias; convertedContactId remains canonical.
  if (!lead.contactId) lead.contactId = contact._id
  if (actorId) lead.updatedBy = actorId
  await lead.save(session ? { session } : undefined)

  const cancelledTaskIds = await TaskService.cancelActiveLeadFollowUps(organizationId, String(lead._id), session)
  effects.cancelTaskReminderIds.push(...cancelledTaskIds)

  if (previousStatus !== LEAD_CONVERSION_STATUS) {
    await emitLifecycleEvent(
      statusEvent(
        organizationId,
        lead,
        previousStatus,
        LEAD_CONVERSION_STATUS,
        actorId,
        changedAt,
        reason,
      ),
      session,
      effects,
    )
  }

  await emitLifecycleEvent({
    organizationId,
    aggregateType: 'lead',
    aggregateId: String(lead._id),
    eventType: 'lead.converted',
    leadId: String(lead._id),
    contactId: String(contact._id),
    actorId,
    payload: {
      summary: `Lead converted to Contact: ${contact.name}`,
      previousStatus,
      newStatus: LEAD_CONVERSION_STATUS,
      changedBy: actorId || 'system',
      changedAt: changedAt.toISOString(),
      reason,
      contactId: String(contact._id),
      cancelledFollowUpTasks: cancelledTaskIds.length,
      cancelledFollowUpTaskIds: cancelledTaskIds,
    },
  }, session, effects)

  return { lead, contact: contactIdentity(contact) }
  })
}

const changeStatus = async (
  organizationId: string,
  leadId: string,
  status: string,
  options: { lostReason?: string; reason?: string; actorId?: string; access?: CrmAccessContext } = {},
): Promise<LeadLifecycleResult> => {
  const newStatus = requireLeadStatus(status)
  await validateConfiguredStage(organizationId, newStatus, options.lostReason)

  if (newStatus === LEAD_CONVERSION_STATUS) {
    return convertToContact(organizationId, leadId, options.actorId, options.access, options.reason || 'Lead won / converted')
  }

  return runLifecycleMutation(organizationId, async (session, effects) => {
    const lead: any = await loadMutableLead(organizationId, leadId, options.access, session)
    if (lead.isConverted) throw new ApiError(409, 'Converted Leads are archived. Continue the relationship from Contacts.')
    await applyStatusChange({
      organizationId,
      lead,
      newStatus,
      actorId: options.actorId,
      lostReason: options.lostReason,
      reason: options.reason,
      session,
      effects,
    })
    return { lead, contact: null }
  })
}

const assignLead = async (
  organizationId: string,
  leadId: string,
  assignedAgent: string,
  options: { actorId?: string; reason?: string; access?: CrmAccessContext } = {},
) => runLifecycleMutation(organizationId, async (session, effects) => {
  if (options.access && !canAssignLeadTo(options.access, assignedAgent)) {
    throw new ApiError(403, 'Assigning a lead to another team member requires leads.assign')
  }
  const lead: any = await loadMutableLead(organizationId, leadId, options.access, session)
  if (lead.isConverted) throw new ApiError(409, 'Converted Leads are archived. Reassign the Contact instead.')

  await CrmAssignableMemberService.assertAssignableMember(organizationId, assignedAgent, 'lead', session)

  const previousAgentId = lead.assignedAgent?.toString()
  if (previousAgentId === String(assignedAgent)) return lead

  lead.assignedAgent = assignedAgent
  if (options.actorId) lead.updatedBy = options.actorId
  await lead.save(session ? { session } : undefined)

  await CrmService.recordAssignment({
    organizationId,
    leadId,
    previousAgentId,
    assignedAgentId: assignedAgent,
    strategy: 'manual',
    reason: options.reason || 'Manual override',
    actorId: options.actorId,
  }, session)

  const reminderTaskIds = await TaskService.reassignActiveLeadFollowUp(organizationId, leadId, assignedAgent, session)
  effects.refreshTaskReminderIds.push(...reminderTaskIds)

  await emitLifecycleEvent({
    organizationId,
    aggregateType: 'lead',
    aggregateId: leadId,
    eventType: 'lead.assigned',
    leadId,
    actorId: options.actorId,
    payload: {
      summary: 'Lead manually reassigned',
      previousAgentId: previousAgentId || '',
      assignedAgentId: assignedAgent,
      reason: options.reason || 'Manual override',
    },
  }, session, effects)

  return lead
})

const scheduleFollowUp = async (
  organizationId: string,
  leadId: string,
  followUpDate: Date | string,
  options: { actorId?: string; reason?: string; title?: string; priority?: 'low'|'medium'|'high'|'urgent'; access?: CrmAccessContext } = {},
) => {
  const dueAt = followUpDate instanceof Date ? followUpDate : new Date(followUpDate)
  if (Number.isNaN(dueAt.getTime())) throw new ApiError(400, 'Invalid follow-up date')

  return runLifecycleMutation(organizationId, async (session, effects) => {
    const lead: any = await loadMutableLead(organizationId, leadId, options.access, session)
    if (lead.isConverted) throw new ApiError(409, 'Converted Leads are archived. Schedule follow-up from the Contact instead.')
    if (!lead.assignedAgent) throw new ApiError(400, 'Assign the Lead before scheduling a follow-up')

    lead.followUpDate = dueAt
    // nextFollowUp remains in the schema only for rollout compatibility. Once this
    // Lead is touched by the canonical scheduler, remove the stale legacy value.
    lead.nextFollowUp = undefined
    if (options.actorId) lead.updatedBy = options.actorId
    await lead.save(session ? { session } : undefined)

    const task: any = await TaskService.syncLeadFollowUpTask({
      organizationId,
      leadId,
      assignedAgent: String(lead.assignedAgent),
      dueAt,
      title: options.title?.trim() || `Follow up with ${lead.name}`,
      description: options.reason || 'Scheduled from Lead follow-up',
      priority: options.priority || 'medium',
    }, session)
    effects.refreshTaskReminderIds.push(String(task._id))

    await emitLifecycleEvent({
      organizationId,
      aggregateType: 'lead',
      aggregateId: leadId,
      eventType: 'lead.follow_up_scheduled',
      leadId,
      actorId: options.actorId,
      payload: {
        summary: `Follow-up scheduled for ${dueAt.toISOString()}`,
        followUpDate: dueAt.toISOString(),
        assignedAgentId: String(lead.assignedAgent),
        reason: options.reason || '',
        taskId: String(task._id),
      },
    }, session, effects)

    return { lead, task }
  })
}

const recordContact = async (
  organizationId: string,
  leadId: string,
  options: { actorId?: string; channel?: ContactChannel; reason?: string; access?: CrmAccessContext } = {},
) => runLifecycleMutation(organizationId, async (session, effects) => {
  const lead: any = await loadMutableLead(organizationId, leadId, options.access, session)
  const now = new Date()
  const firstResponse = !lead.firstResponseAt
  if (!lead.firstResponseAt) lead.firstResponseAt = now
  if (!lead.firstContactedAt) lead.firstContactedAt = now
  lead.lastContact = now
  if (firstResponse && lead.responseDueAt && lead.responseDueAt < now && !lead.slaBreachedAt) lead.slaBreachedAt = now
  if (options.actorId) lead.updatedBy = options.actorId

  if (!lead.isConverted && (normalizeLeadStatus(lead.leadStatus) || lead.leadStatus) === LEAD_STATUS.NEW) {
    await applyStatusChange({
      organizationId,
      lead,
      newStatus: LEAD_STATUS.CONTACTED,
      actorId: options.actorId,
      reason: options.reason || `First ${options.channel || 'manual'} interaction recorded`,
      session,
      effects,
    })
  } else {
    await lead.save(session ? { session } : undefined)
  }

  if (firstResponse) {
    await emitLifecycleEvent({
      organizationId,
      aggregateType: 'lead',
      aggregateId: leadId,
      eventType: 'lead.response_recorded',
      leadId,
      actorId: options.actorId,
      payload: {
        summary: `First contact recorded via ${options.channel || 'manual'}`,
        channel: options.channel || 'manual',
        firstResponseAt: now.toISOString(),
        firstContactedAt: now.toISOString(),
        withinSla: !lead.responseDueAt || lead.responseDueAt >= now,
        reason: options.reason || '',
      },
    }, session, effects)
  }

  return lead
})

const reengage = async (
  organizationId: string,
  leadId: string,
  options: { actorId?: string; reason?: string; access?: CrmAccessContext } = {},
): Promise<LeadLifecycleResult> => changeStatus(organizationId, leadId, LEAD_STATUS.RE_ENGAGED, {
  ...options,
  reason: options.reason || 'Dormant lead re-engaged',
})

export const LeadLifecycleService = {
  changeStatus,
  assignLead,
  scheduleFollowUp,
  recordContact,
  convertToContact,
  reengage,
}
