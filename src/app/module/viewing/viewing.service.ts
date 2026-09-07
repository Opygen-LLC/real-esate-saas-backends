import httpStatus from 'http-status'
import type { ClientSession } from 'mongoose'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { createQueryProfile } from '../../helpers/queryPerformance'
import { safeRegexPattern } from '../../helpers/searchQuery'
import { normalizeBangladeshPhone } from '../../helpers/identity'
import { PrivacyConsentService } from '../privacy/privacyConsent.service'
import { PrivacyPolicyService } from '../privacy/privacyPolicy.service'
import { CrmService } from '../crm/crm.service'
import { canManageTeamCrm, crmMutationOwnerFilter, crmReadOwnerFilter, type CrmAccessContext } from '../crm/crmAccess'
import { CrmAssignableMemberService } from '../crm/crmAssignableMember.service'
import { TransactionalOutbox } from '../domainEvent/transactionalOutbox.service'
import { Lead } from '../lead/lead.model'
import { LeadEntitlementService } from '../lead/leadEntitlement.service'
import { LeadLifecycleService } from '../lead/leadLifecycle.service'
import { LEAD_STATUS } from '../lead/leadStatus.contract'
import { OperationsQueueService } from '../operationsQueue/operationsQueue.service'
import { Property } from '../property/property.model'
import { VIEWING_REQUESTABLE_PROPERTY_STATUSES } from '../property/property.constants'
import { userRefPopulate } from '../user/userProfile.service'
import { IViewing, IViewingCalendarFilter, IViewingFilter, ViewingCalendarItem } from './viewing.interface'
import { Viewing } from './viewing.model'
import type { PublicViewingRequestInput } from './viewing.validation'
import { TenantAccessService } from '../tenantAccess/tenantAccess.service'
import { WebsiteSubmissionService } from '../websiteSubmission/websiteSubmission.service'
import { viewingTransaction } from './viewingTransaction'
import { ACTIVE_VIEWING_STATUSES, assertViewingWindow, isActiveViewingStatus } from './viewingWindow'
import { captureViewingLead } from './viewingLead.service'
import { ViewingRequestReceipt } from './viewingRequestReceipt.model'
import { viewingRequestIdentity, VIEWING_RECEIPT_TTL_MS } from './viewingIdempotency'

const normalizePhone = (value: string): string => {
  try { return normalizeBangladeshPhone(value) } catch (error) { throw new ApiError(400, (error as Error).message) }
}
const referenceId = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'object' && '_id' in value) return String((value as { _id: unknown })._id)
  return String(value)
}

const assertViewingRequestableProperty = async (organizationId: string, propertyId: string, session?: ClientSession) => {
  const query = Property.findOne({ _id: propertyId, organizationId, quotaLocked: { $ne: true } }).select('agentId status title')
  if (session) query.session(session)
  const property: any = await query.lean()
  if (!property) throw new ApiError(404, 'Property not found')
  if (!VIEWING_REQUESTABLE_PROPERTY_STATUSES.includes(property.status)) throw new ApiError(409, 'This property is no longer accepting viewing requests', '', 'PROPERTY_VIEWING_UNAVAILABLE')
  return property
}

const assertViewingLead = async (organizationId: string, leadId: string, session: ClientSession, access?: CrmAccessContext) => {
  const lead = await Lead.findOne({ _id: leadId, organizationId, ...crmReadOwnerFilter('assignedAgent', access) }).session(session)
  if (!lead) throw new ApiError(404, 'Linked lead not found')
  await LeadEntitlementService.assertLeadAccessible(organizationId, leadId, session)
  return lead
}

/** Advisory only outside viewingTransaction; mutations always hold the tenant write lock. */
const checkConflict = async (organizationId: string, agentId: string, propertyId: string, date: string, startTime: string, endTime: string, excludeViewingId?: string, session?: ClientSession) => {
  assertViewingWindow(date, startTime, endTime)
  const query = Viewing.findOne({
    organizationId, date, status: { $in: [...ACTIVE_VIEWING_STATUSES] },
    startTime: { $lt: endTime }, endTime: { $gt: startTime }, $or: [{ agentId }, { propertyId }],
    ...(excludeViewingId ? { _id: { $ne: excludeViewingId } } : {}),
  }).select('agentId propertyId startTime endTime')
  if (session) query.session(session)
  const conflict: any = await query.lean()
  if (!conflict) return { hasConflict: false }
  if (String(conflict.agentId) === agentId) return { hasConflict: true, reason: 'The assigned agent is unavailable for this time', code: 'VIEWING_AGENT_BUSY' }
  return { hasConflict: true, reason: 'This property is unavailable for this time', code: 'VIEWING_SLOT_UNAVAILABLE' }
}

const rejectConflict = async (organizationId: string, agentId: string, propertyId: string, date: string, startTime: string, endTime: string, session: ClientSession, excludeId?: string) => {
  const conflict = await checkConflict(organizationId, agentId, propertyId, date, startTime, endTime, excludeId, session)
  if (conflict.hasConflict) throw new ApiError(409, conflict.reason || 'Viewing conflict', '', conflict.code || 'VIEWING_SLOT_UNAVAILABLE')
}

const scheduleReminder = async (viewing: any, session: ClientSession) => {
  const crm: any = await CrmService.getConfig(viewing.organizationId, session)
  const start = Date.parse(`${viewing.date}T${viewing.startTime}:00+06:00`)
  const runAt = new Date(start - Number(crm.reminders?.viewingMinutesBefore || 0) * 60000)
  await OperationsQueueService.schedule({ organizationId: viewing.organizationId, type: 'viewing_reminder', entityId: String(viewing._id), runAt, payload: { agentId: referenceId(viewing.agentId), scheduleVersion: viewing.scheduleVersion } }, { session })
}

const queueViewingEffects = async (viewing: any, session: ClientSession) => {
  if (isActiveViewingStatus(viewing.status)) await scheduleReminder(viewing, session)
  else await OperationsQueueService.cancel(viewing.organizationId, 'viewing_reminder', String(viewing._id), { session })
  await OperationsQueueService.schedule({ organizationId: viewing.organizationId, type: 'calendar_sync', entityId: String(viewing._id), runAt: new Date(), payload: { scheduleVersion: viewing.scheduleVersion } }, { session })
}

const changeLinkedLeadStage = async (organizationId: string, leadId: string, status: string, session: ClientSession, actorId?: string, access?: CrmAccessContext) => {
  const lifecycle = await LeadLifecycleService.changeStatusInTransaction(organizationId, leadId, status, session, { actorId, access, reason: status === LEAD_STATUS.VIEWING_COMPLETED ? 'Viewing completed' : 'Viewing scheduled' })
  // Viewing stages only project events. Persist every delivery intention before commit.
  for (const event of lifecycle.effects.events) await TransactionalOutbox.queuePublish(event, session)
  if (lifecycle.effects.cancelTaskReminderIds.length || lifecycle.effects.refreshTaskReminderIds.length) {
    throw new ApiError(500, 'Unexpected task effect for a viewing stage; no changes were committed')
  }
}

const createViewingInTransaction = async (organizationId: string, payload: Partial<IViewing>, session: ClientSession, actorId?: string, access?: CrmAccessContext): Promise<any> => {
  const agentId = referenceId(payload.agentId) || ''
  const propertyId = referenceId(payload.propertyId) || ''
  const leadId = referenceId(payload.leadId)
  if (access && !canManageTeamCrm(access) && agentId !== access.userId) throw new ApiError(403, 'Team members can only schedule viewings assigned to themselves')
  assertViewingWindow(payload.date || '', payload.startTime || '', payload.endTime || '', true)
  await CrmAssignableMemberService.assertAssignableMember(organizationId, agentId, 'viewing', session)
  await assertViewingRequestableProperty(organizationId, propertyId, session)
  if (leadId) await assertViewingLead(organizationId, leadId, session, access)
  const status = payload.status || 'Scheduled'
  if (isActiveViewingStatus(status)) await rejectConflict(organizationId, agentId, propertyId, payload.date!, payload.startTime!, payload.endTime!, session)
  const viewing: any = (await Viewing.create([{
    organizationId, propertyId, agentId, leadId, date: payload.date, startTime: payload.startTime, endTime: payload.endTime,
    status, clientName: payload.clientName, clientPhone: normalizePhone(payload.clientPhone || ''),
    clientEmail: payload.clientEmail, notes: payload.notes || '', scheduleVersion: 1, calendarSyncStatus: 'pending',
  }], { session }))[0]
  if (leadId && isActiveViewingStatus(status)) await changeLinkedLeadStage(organizationId, leadId, LEAD_STATUS.VIEWING_SCHEDULED, session, actorId || agentId, access)
  await queueViewingEffects(viewing, session)
  await TransactionalOutbox.emit({ organizationId, aggregateType: 'viewing', aggregateId: String(viewing._id), eventType: 'viewing.scheduled', leadId, propertyId, actorId: actorId || agentId, payload: { summary: `Viewing scheduled for ${viewing.date} at ${viewing.startTime}` } }, session)
  return viewing
}

const createViewing = async (organizationId: string, payload: Partial<IViewing>, actorId?: string, access?: CrmAccessContext): Promise<IViewing> =>
  viewingTransaction(organizationId, (session) => createViewingInTransaction(organizationId, payload, session, actorId, access))

const resolvePublicViewingAgent = async (organizationId: string, ownerId: unknown, session: ClientSession, preferredAgentId?: string): Promise<string> => {
  for (const candidate of [...new Set([preferredAgentId, referenceId(ownerId)].filter(Boolean))]) {
    const member = await CrmAssignableMemberService.getAssignableMemberForCapabilities(organizationId, candidate!, ['viewing', 'lead'], session)
    if (member?._id) return String(member._id)
  }
  const fallback = await CrmAssignableMemberService.listAssignableMembersForCapabilities(organizationId, ['viewing', 'lead'], { session })
  if (!fallback[0]?._id) throw new ApiError(503, 'This agency is not accepting viewing requests right now', '', 'VIEWING_AGENT_UNAVAILABLE')
  return String(fallback[0]._id)
}

const publicRequestViewing = async (input: PublicViewingRequestInput, context: { ip?: string; requestId?: string; idempotencyKey?: string }) => {
  const payload = { ...input, clientPhone: normalizePhone(input.clientPhone) }
  const { organizationId, propertyId, date, startTime, endTime } = payload
  const identity = viewingRequestIdentity(payload, context.idempotencyKey)
  // Reconcile subscription boundaries before entering the business transaction.
  await TenantAccessService.assertPublicWebsiteAccess(organizationId)
  return viewingTransaction(organizationId, async (session, organization) => {
    const key = { organizationId, keyDigest: identity.keyDigest }
    const previous: any = await ViewingRequestReceipt.findOne(key).session(session).lean()
    if (previous && new Date(previous.expiresAt).getTime() > Date.now()) {
      if (previous.payloadHash !== identity.payloadHash) throw new ApiError(409, 'This request key has already been used for a different viewing', '', 'IDEMPOTENCY_KEY_REUSED')
      return { data: previous.response, replayed: true }
    }
    if (previous) await ViewingRequestReceipt.deleteOne({ _id: previous._id, organizationId }, { session })
    assertViewingWindow(date, startTime, endTime, true)
    if (!payload.privacyConsent) throw new ApiError(400, 'Privacy consent is required')
    await PrivacyPolicyService.assertCurrentPublicPolicy(payload.policyVersion)
    const property: any = await assertViewingRequestableProperty(organizationId, propertyId, session)
    const agentId = await resolvePublicViewingAgent(organizationId, organization.ownerId, session, referenceId(property.agentId))
    await rejectConflict(organizationId, agentId, propertyId, date, startTime, endTime, session)
    const lead = await captureViewingLead(payload, agentId, session)
    await PrivacyConsentService.recordPublicPrivacyPolicy(organizationId, payload.clientPhone, payload.policyVersion, context, session)
    const viewing = await createViewingInTransaction(organizationId, {
      propertyId, agentId, leadId: lead._id, date, startTime, endTime, status: 'Scheduled',
      clientName: payload.clientName, clientPhone: payload.clientPhone, clientEmail: payload.clientEmail, notes: payload.notes,
    }, session, agentId)
    const submission = await WebsiteSubmissionService.captureViewing(payload, viewing, session)
    // Do not expose a CRM Lead, internal assignee or the visitor's contact data in a public receipt.
    const response = WebsiteSubmissionService.withPublicReceipt({ _id: String(viewing._id), date, startTime, endTime, status: viewing.status }, submission)
    await ViewingRequestReceipt.create([{ ...key, payloadHash: identity.payloadHash, response, expiresAt: new Date(Date.now() + VIEWING_RECEIPT_TTL_MS) }], { session })
    return { data: response, replayed: false }
  }, true)
}

const VIEWING_LIST_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'date', 'status', 'clientName'])

const getAllViewings = async (
  filters: IViewingFilter,
  paginationOptions: IPaginationOptions,
  access?: CrmAccessContext,
): Promise<IGenericResponse<IViewing[]>> => {
  const { searchTerm, organizationId, propertyId, agentId, leadId, status, date, startDate, endDate, viewMode = 'list' } = filters
  const conditions: any[] = []
  if (organizationId) conditions.push({ organizationId })
  const ownerScope = crmReadOwnerFilter('agentId', access)
  if (Object.keys(ownerScope).length) conditions.push(ownerScope)
  if (propertyId) conditions.push({ propertyId })
  if (agentId) conditions.push({ agentId })
  if (leadId) conditions.push({ leadId })
  if (status) conditions.push({ status })
  if (date) conditions.push({ date })
  if (startDate || endDate) conditions.push({ date: { ...(startDate ? { $gte: startDate } : {}), ...(endDate ? { $lte: endDate } : {}) } })
  if (searchTerm) {
    const raw = String(searchTerm).trim()
    const search = safeRegexPattern(raw)
    const prefix = { $regex: `^${search}`, $options: 'i' }
    if (raw.includes('@')) conditions.push({ clientEmail: { $regex: `^${search}$`, $options: 'i' } })
    else if (/^[+()\d\s-]{6,30}$/.test(raw)) conditions.push({ clientPhone: raw })
    else conditions.push({ $or: [{ clientName: prefix }, { notes: prefix }] })
  }

  const where = conditions.length ? { $and: conditions } : {}
  const calendarMode = viewMode === 'calendar'
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(
    paginationOptions,
    calendarMode ? { sortBy: 'date', sortOrder: 'asc' } : { sortBy: 'createdAt', sortOrder: 'desc' },
  )
  const sort = calendarMode
    ? paginationHelper.buildCalendarSort()
    : paginationHelper.buildAllowedStableSort(sortBy, sortOrder, VIEWING_LIST_SORT_FIELDS, 'createdAt')

  const profile = createQueryProfile('/api/v1/viewing', String(organizationId || ''))
  const [result, total] = await profile.db(() => Promise.all([
    Viewing.find(where)
      .populate({ path: 'propertyId', select: 'title price images address city', match: { organizationId } })
      .populate(userRefPopulate('agentId', 'name email phoneNumber userRole', { organizationId }))
      .populate({ path: 'leadId', select: 'name phone email leadStatus', match: { organizationId, isLocked: { $ne: true } } })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Viewing.countDocuments(where),
  ]), 2)
  profile.finish(result.length, { paginationMode: 'page', calendarMode })
  return { meta: { page, limit, total, paginationMode: 'page' }, data: result as IViewing[] }
}
const getCalendarViewings = async (filters: IViewingCalendarFilter, access?: CrmAccessContext): Promise<ViewingCalendarItem[]> => {
  const { organizationId, startDate, endDate, status, propertyId, agentId } = filters
  const where: Record<string, unknown> = {
    organizationId,
    ...crmReadOwnerFilter('agentId', access),
    date: { $gte: startDate, $lte: endDate },
    ...(status ? { status } : {}),
    ...(propertyId ? { propertyId } : {}),
    ...(agentId ? { agentId } : {}),
  }

  const rows: any[] = await Viewing.find(where)
    .select('_id date startTime endTime status clientName propertyId agentId')
    .populate({ path: 'propertyId', select: 'title city', match: { organizationId } })
    .populate(userRefPopulate('agentId', 'name', { organizationId }))
    .sort(paginationHelper.buildCalendarSort())
    .limit(2001)
    .lean()

  if (rows.length > 2000) {
    throw new ApiError(413, 'Too many viewings in this calendar range. Narrow the date range or filters.')
  }

  return rows.map((row) => ({
    _id: String(row._id),
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    status: row.status,
    clientName: row.clientName,
    property: row.propertyId
      ? { _id: String(row.propertyId._id), title: row.propertyId.title || 'Property', city: row.propertyId.city }
      : null,
    agent: row.agentId
      ? { _id: String(row.agentId._id), name: row.agentId.name || 'Assigned broker' }
      : null,
  }))
}


const getViewingById = async (organizationId: string, id: string, access?: CrmAccessContext) => {
  const result = await Viewing.findOne({ _id: id, organizationId, ...crmReadOwnerFilter('agentId', access) })
    .populate({ path: 'propertyId', select: 'title price images address city propertyType bedrooms bathrooms', match: { organizationId } })
    .populate(userRefPopulate('agentId', 'name email phoneNumber userRole', { organizationId }))
    .populate({ path: 'leadId', select: 'name phone email leadStatus', match: { organizationId, isLocked: { $ne: true } } })
  if (!result) throw new ApiError(404, 'Viewing not found')
  return result
}

const updateViewing = async (organizationId: string, id: string, input: Partial<IViewing>, actorId?: string, access?: CrmAccessContext) => {
  // Keep tenant, provider-state and version fields immutable even for internal callers.
  const allowed = ['propertyId', 'agentId', 'leadId', 'date', 'startTime', 'endTime', 'clientName', 'clientPhone', 'clientEmail', 'status', 'notes', 'feedback'] as const
  const payload: Partial<IViewing> = Object.fromEntries(allowed.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]))
  if (payload.clientPhone) payload.clientPhone = normalizePhone(payload.clientPhone)
  await viewingTransaction(organizationId, async (session) => {
    const scope = { _id: id, organizationId, ...crmMutationOwnerFilter('agentId', access) }
    const existing: any = await Viewing.findOne(scope).session(session)
    if (!existing) throw new ApiError(404, 'Viewing not found')
    const agentId = referenceId(payload.agentId ?? existing.agentId) || ''
    const propertyId = referenceId(payload.propertyId ?? existing.propertyId) || ''
    const leadId = referenceId(payload.leadId ?? existing.leadId)
    if (access && !canManageTeamCrm(access) && agentId !== access.userId) throw new ApiError(403, 'Team members cannot reassign viewings to another member')
    const date = payload.date ?? existing.date
    const startTime = payload.startTime ?? existing.startTime
    const endTime = payload.endTime ?? existing.endTime
    const status = payload.status ?? existing.status
    const scheduleChanged = date !== existing.date || startTime !== existing.startTime || endTime !== existing.endTime ||
      agentId !== referenceId(existing.agentId) || propertyId !== referenceId(existing.propertyId)
    const reactivated = isActiveViewingStatus(status) && !isActiveViewingStatus(existing.status)
    assertViewingWindow(date, startTime, endTime, isActiveViewingStatus(status) && (scheduleChanged || reactivated))
    if (isActiveViewingStatus(status)) {
      if (scheduleChanged || reactivated) {
        await CrmAssignableMemberService.assertAssignableMember(organizationId, agentId, 'viewing', session)
        await assertViewingRequestableProperty(organizationId, propertyId, session)
      }
      await rejectConflict(organizationId, agentId, propertyId, date, startTime, endTime, session, id)
    }
    if (leadId) await assertViewingLead(organizationId, leadId, session, access)
    const result: any = await Viewing.findOneAndUpdate(scope, { $set: { ...payload, scheduleVersion: Number(existing.scheduleVersion || 1) + 1, calendarSyncStatus: 'pending' } }, { new: true, runValidators: true, session })
    if (!result) throw new ApiError(404, 'Viewing not found')
    if (leadId && status === 'Completed' && existing.status !== 'Completed') {
      await changeLinkedLeadStage(organizationId, leadId, LEAD_STATUS.VIEWING_COMPLETED, session, actorId, access)
    } else if (leadId && reactivated) {
      await changeLinkedLeadStage(organizationId, leadId, LEAD_STATUS.VIEWING_SCHEDULED, session, actorId, access)
    }
    await queueViewingEffects(result, session)
    await TransactionalOutbox.emit({ organizationId, aggregateType: 'viewing', aggregateId: id,
      eventType: status === 'Completed' ? 'viewing.completed' : 'viewing.updated', leadId, propertyId, actorId: actorId || agentId,
      payload: { summary: `Viewing ${status} for ${date} at ${startTime}`, status },
    }, session)
    return result
  })
  return getViewingById(organizationId, id, access)
}

const deleteViewing = async (organizationId: string, id: string, access?: CrmAccessContext) =>
  viewingTransaction(organizationId, async (session) => {
    const result: any = await Viewing.findOneAndDelete({ _id: id, organizationId, ...crmMutationOwnerFilter('agentId', access) }, { session })
    if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Viewing not found')
    await OperationsQueueService.cancel(organizationId, 'viewing_reminder', id, { session })
    await OperationsQueueService.cancel(organizationId, 'calendar_sync', id, { session })
    // A durable tombstone tells the gateway to cancel even though the row is gone.
    await OperationsQueueService.schedule({ organizationId, type: 'calendar_delete', entityId: id, runAt: new Date(), payload: { scheduleVersion: Number(result.scheduleVersion || 1) + 1, providerEventId: result.calendarProviderEventId || '' }, maxAttempts: 10 }, { session })
    await TransactionalOutbox.emit({ organizationId, aggregateType: 'viewing', aggregateId: id, eventType: 'viewing.deleted',
      leadId: referenceId(result.leadId), propertyId: referenceId(result.propertyId), actorId: access?.userId || referenceId(result.agentId),
      payload: { summary: `Viewing deleted for ${result.date} at ${result.startTime}`, status: result.status },
    }, session)
    return result
  })

export const ViewingService = { checkConflict, createViewing, publicRequestViewing, getAllViewings, getCalendarViewings, getViewingById, updateViewing, deleteViewing }
