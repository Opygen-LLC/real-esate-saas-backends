import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { normalizeBangladeshPhone, normalizeEmail } from '../../helpers/identity'
import { Activity } from '../activity/activity.model'
import { ActivityExportService } from '../activity/activityExport.service'
import { User } from '../user/user.model'
import { crmMutationOwnerFilter, crmReadOwnerFilter, type CrmAccessContext } from '../crm/crmAccess'
import { buildCrmCsv, buildCrmXlsx, type CrmExportColumn, type CrmExportRow } from '../crm/crmExport.service'
import { userRefPopulate } from '../user/userProfile.service'
import { DomainEventService } from '../domainEvent/domainEvent.service'
import { CRM_FOLLOW_UP_TIME_ZONE, getDayBoundsInTimeZone, getWeekBoundsInTimeZone } from '../lead/leadFollowUpTime'
import { LEAD_STATUS_LABELS, leadStatusFilterValues, normalizeLeadStatus } from '../lead/leadStatus.contract'
import { IContact, IContactFilter, IContactLatestInteraction } from './contact.interface'
import { Contact } from './contact.model'
import {
  CONTACT_RELATIONSHIP_STATE,
  visibleContactRelationshipFilter,
} from './contactRelationship.contract'

const normalizePhone = (value: string): string => {
  try { return normalizeBangladeshPhone(value) } catch (error) { throw new ApiError(400, (error as Error).message) }
}

const normalizeOptionalEmail = (value?: string): string => value?.trim() ? normalizeEmail(value) : ''

const prepareEditablePayload = (payload: Partial<IContact>, actorId?: string) => {
  const prepared: any = { ...payload }
  for (const field of ['normalizedPhone','normalizedEmail','relationshipState','sourceLeadId','convertedAt','convertedBy','createdBy','updatedBy','statusAtConversion','latestInteraction','notes']) {
    delete prepared[field]
  }
  if (prepared.phone !== undefined) {
    prepared.phone = normalizePhone(prepared.phone)
    prepared.normalizedPhone = prepared.phone
  }
  if (prepared.email !== undefined) {
    const normalizedEmail = normalizeOptionalEmail(prepared.email)
    prepared.email = normalizedEmail || undefined
    prepared.normalizedEmail = normalizedEmail
  }
  if (prepared.followUpDate !== undefined) {
    const date = new Date(prepared.followUpDate)
    if (Number.isNaN(date.getTime())) throw new ApiError(400, 'Invalid contact follow-up date')
    prepared.followUpDate = date
  }
  if (actorId) prepared.updatedBy = actorId
  return prepared
}

const assertAssignedMember = async (organizationId: string, assignedTo?: string | object) => {
  if (!assignedTo) return
  const member = await User.exists({ _id: assignedTo, organizationId, status: 'active' })
  if (!member) throw new ApiError(400, 'Assigned contact owner must be an active member of this agency')
}

const parseBoundary = (value: string | undefined, field: string) => {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new ApiError(400, `Invalid ${field}`)
  return date
}

const buildContactWhere = (filters: IContactFilter, access?: CrmAccessContext) => {
  const {
    searchTerm, organizationId, type, city, tag, assignedTo, source, origin,
    statusAtConversion, convertedFrom, convertedTo, followUpPreset, followUpFrom, followUpTo,
  } = filters
  const conditions: Array<Record<string, unknown>> = []

  if (organizationId) conditions.push({ organizationId })
  const ownerScope = crmReadOwnerFilter('assignedTo', access)
  if (Object.keys(ownerScope).length) conditions.push(ownerScope)
  conditions.push(visibleContactRelationshipFilter)

  if (searchTerm) {
    const escaped = String(searchTerm).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    conditions.push({
      $or: ['name', 'email', 'phone', 'company', 'city'].map((field) => ({
        [field]: { $regex: escaped, $options: 'i' },
      })),
    })
  }
  if (type) conditions.push({ type })
  if (city) conditions.push({ city: { $regex: String(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })
  if (tag) conditions.push({ tags: tag })
  if (assignedTo) conditions.push({ assignedTo })
  if (source) conditions.push({ source })

  if (origin === 'converted') conditions.push({ sourceLeadId: { $type: 'objectId' }, convertedAt: { $type: 'date' } })
  else if (origin === 'manual') conditions.push({ $or: [{ sourceLeadId: { $exists: false } }, { sourceLeadId: null }] })
  else if (origin) throw new ApiError(400, 'Unsupported Contact origin filter')

  if (statusAtConversion) {
    const values = leadStatusFilterValues(statusAtConversion)
    if (!values.length) throw new ApiError(400, `Unsupported conversion status: ${String(statusAtConversion)}`)
    conditions.push(values.length === 1 ? { statusAtConversion: values[0] } : { statusAtConversion: { $in: values } })
  }

  const convertedStart = parseBoundary(convertedFrom, 'convertedFrom')
  const convertedEnd = parseBoundary(convertedTo, 'convertedTo')
  if (convertedStart && convertedEnd && convertedStart >= convertedEnd) throw new ApiError(400, 'convertedTo must be later than convertedFrom')
  if (convertedStart || convertedEnd) conditions.push({ convertedAt: { ...(convertedStart ? { $gte: convertedStart } : {}), ...(convertedEnd ? { $lt: convertedEnd } : {}) } })

  const followStart = parseBoundary(followUpFrom, 'followUpFrom')
  const followEnd = parseBoundary(followUpTo, 'followUpTo')
  if (followStart && followEnd && followStart >= followEnd) throw new ApiError(400, 'followUpTo must be later than followUpFrom')
  if (followStart || followEnd) conditions.push({ followUpDate: { ...(followStart ? { $gte: followStart } : {}), ...(followEnd ? { $lt: followEnd } : {}) } })

  if (followUpPreset) {
    if (followUpFrom || followUpTo) throw new ApiError(400, 'Use either followUpPreset or a custom follow-up range, not both')
    const day = getDayBoundsInTimeZone(new Date(), CRM_FOLLOW_UP_TIME_ZONE)
    if (followUpPreset === 'scheduled') conditions.push({ followUpDate: { $type: 'date' } })
    else if (followUpPreset === 'today') conditions.push({ followUpDate: { $gte: day.start, $lt: day.endExclusive } })
    else if (followUpPreset === 'thisWeek') {
      const week = getWeekBoundsInTimeZone(new Date(), CRM_FOLLOW_UP_TIME_ZONE)
      conditions.push({ followUpDate: { $gte: week.start, $lt: week.endExclusive } })
    }
    else if (followUpPreset === 'overdue') conditions.push({ followUpDate: { $type: 'date', $lt: day.start } })
    else if (followUpPreset === 'none') conditions.push({ $or: [{ followUpDate: { $exists: false } }, { followUpDate: null }] })
    else throw new ApiError(400, `Unsupported follow-up filter: ${String(followUpPreset)}`)
  }

  return conditions.length ? { $and: conditions } : {}
}

const latestInteractionProjection = async (organizationId: string, contacts: any[]): Promise<Map<string, IContactLatestInteraction>> => {
  const result = new Map<string, IContactLatestInteraction>()
  if (!contacts.length) return result

  const contactToContact = new Map<string, string>()
  const leadToContact = new Map<string, string>()
  const contactIds: any[] = []
  const leadIds: any[] = []
  for (const contact of contacts) {
    const contactId = String(contact._id)
    contactToContact.set(contactId, contactId)
    contactIds.push(contact._id)
    const sourceLeadId = typeof contact.sourceLeadId === 'object' ? contact.sourceLeadId?._id : contact.sourceLeadId
    if (sourceLeadId) {
      leadToContact.set(String(sourceLeadId), contactId)
      leadIds.push(sourceLeadId)
    }
  }

  const relationshipMatch: Record<string, unknown>[] = [{ contactId: { $in: contactIds } }]
  if (leadIds.length) relationshipMatch.push({ leadId: { $in: leadIds } })
  const activities: any[] = await Activity.find({
    organizationId,
    $and: [
      { $or: relationshipMatch },
      {
        $or: [
          { type: { $in: ['call', 'email', 'whatsapp', 'meeting', 'note', 'viewing', 'offer'] } },
          { 'metadata.eventType': { $regex: '^sms\\.' } },
        ],
      },
    ],
  })
    .select('_id leadId contactId type title content metadata createdAt')
    .sort({ createdAt: -1, _id: -1 })
    .lean()

  for (const activity of activities) {
    const contactId = activity.contactId ? contactToContact.get(String(activity.contactId)) : undefined
    const mappedContactId = contactId || (activity.leadId ? leadToContact.get(String(activity.leadId)) : undefined)
    if (!mappedContactId || result.has(mappedContactId)) continue
    result.set(mappedContactId, {
      id: String(activity._id),
      type: String(activity.metadata?.eventType || activity.type || 'interaction'),
      title: String(activity.title || 'CRM interaction'),
      ...(activity.content ? { content: String(activity.content) } : {}),
      occurredAt: activity.createdAt,
      ...(activity.leadId ? { leadId: String(activity.leadId) } : {}),
      ...(activity.contactId ? { contactId: String(activity.contactId) } : {}),
    })
  }
  return result
}

const createContact = async (
  organizationId: string,
  payload: Partial<IContact>,
  actorId?: string,
  access?: CrmAccessContext,
): Promise<IContact> => {
  const prepared: any = prepareEditablePayload(payload, actorId)
  if (access && !access.isManager) {
    if (prepared.assignedTo && String(prepared.assignedTo) !== access.userId) {
      throw new ApiError(403, 'Team members can only create contacts assigned to themselves')
    }
    prepared.assignedTo = access.userId
  }
  await assertAssignedMember(organizationId, prepared.assignedTo)
  const result: any = await Contact.create({
    ...prepared,
    organizationId,
    createdBy: actorId || undefined,
    updatedBy: actorId || undefined,
    relationshipState: CONTACT_RELATIONSHIP_STATE.ACTIVE,
  })
  await DomainEventService.emit({
    organizationId,
    aggregateType: 'contact',
    aggregateId: result._id.toString(),
    eventType: 'contact.created',
    contactId: result._id.toString(),
    actorId,
    payload: { summary: `Contact created: ${result.name}` },
  })
  return result
}

const getAllContacts = async (
  filters: IContactFilter,
  paginationOptions: IPaginationOptions,
  access?: CrmAccessContext,
): Promise<IGenericResponse<IContact[]>> => {
  const whereCondition = buildContactWhere(filters, access)
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)

  const [contacts, total] = await Promise.all([
    Contact.find(whereCondition)
      .populate(userRefPopulate('assignedTo', 'name email phoneNumber userRole profileImgURL'))
      .populate({ path: 'sourceLeadId', select: 'name phone email leadStatus source budgetMin budgetMax currency locationPreference propertyType propertyInterest createdAt convertedAt isConverted', populate: { path: 'propertyInterest', select: 'title' } })
      .populate('propertyInterest', 'title price images city propertyType')
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit)
      .lean(),
    Contact.countDocuments(whereCondition),
  ])

  const organizationId = String(filters.organizationId || '')
  const latestByContact = organizationId ? await latestInteractionProjection(organizationId, contacts) : new Map<string, IContactLatestInteraction>()
  const data = contacts.map((contact: any) => ({ ...contact, latestInteraction: latestByContact.get(String(contact._id)) })) as IContact[]

  return { meta: { page, limit, total }, data }
}

const getContactById = async (organizationId: string, id: string, access?: CrmAccessContext): Promise<IContact | null> => {
  const result = await Contact.findOne({ _id: id, organizationId, ...crmReadOwnerFilter('assignedTo', access), ...visibleContactRelationshipFilter })
    .populate(userRefPopulate('assignedTo', 'name email phoneNumber userRole profileImgURL'))
    .populate(userRefPopulate('convertedBy', 'name email userRole profileImgURL'))
    .populate(userRefPopulate('createdBy', 'name email userRole profileImgURL'))
    .populate(userRefPopulate('updatedBy', 'name email userRole profileImgURL'))
    .populate({ path: 'sourceLeadId', select: 'name phone email source leadStatus budgetMin budgetMax currency locationPreference propertyType bedrooms propertyInterest firstContactedAt followUpDate convertedAt createdAt updatedAt isConverted', populate: { path: 'propertyInterest', select: 'title price city propertyType' } })
    .populate('propertyInterest', 'title price images city propertyType bedrooms bathrooms')
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Contact not found')
  return result
}

const updateContact = async (
  organizationId: string,
  id: string,
  payload: Partial<IContact>,
  actorId?: string,
  access?: CrmAccessContext,
): Promise<IContact | null> => {
  const prepared: any = prepareEditablePayload(payload, actorId)
  if (access && !access.isManager && prepared.assignedTo !== undefined && String(prepared.assignedTo) !== access.userId) {
    throw new ApiError(403, 'Team members cannot reassign contacts to another member')
  }
  await assertAssignedMember(organizationId, prepared.assignedTo)
  const result = await Contact.findOneAndUpdate({ _id: id, organizationId, ...crmMutationOwnerFilter('assignedTo', access), ...visibleContactRelationshipFilter }, prepared, {
    new: true,
    runValidators: true,
  })
    .populate(userRefPopulate('assignedTo', 'name email phoneNumber userRole profileImgURL'))
    .populate('sourceLeadId', 'name phone email leadStatus source createdAt')
    .populate('propertyInterest', 'title price images city propertyType')
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Contact not found')
  await DomainEventService.emit({
    organizationId,
    aggregateType: 'contact',
    aggregateId: id,
    eventType: 'contact.updated',
    contactId: id,
    leadId: result.sourceLeadId ? String((result.sourceLeadId as any)?._id || result.sourceLeadId) : undefined,
    actorId,
    payload: { summary: 'Contact profile fields updated', fields: Object.keys(prepared) },
  })
  return result
}

const deleteContact = async (organizationId: string, id: string, access?: CrmAccessContext): Promise<IContact | null> => {
  const result = await Contact.findOneAndDelete({ _id: id, organizationId, ...crmMutationOwnerFilter('assignedTo', access), ...visibleContactRelationshipFilter })
  if (!result) throw new ApiError(httpStatus.NOT_FOUND, 'Contact not found')
  return result
}

const MAX_EXPORT_ROWS = 50_000
const CONTACT_EXPORT_COLUMNS: CrmExportColumn[] = [
  { header: 'Name', key: 'name', width: 24 },
  { header: 'Phone', key: 'phone', width: 18 },
  { header: 'Email', key: 'email', width: 28 },
  { header: 'Type', key: 'type', width: 16 },
  { header: 'Source', key: 'source', width: 16 },
  { header: 'Status', key: 'status', width: 22 },
  { header: 'Assignee', key: 'assignee', width: 24 },
  { header: 'Follow-up Date', key: 'followUpDate', width: 24 },
  { header: 'Property Interest', key: 'propertyInterest', width: 38 },
  { header: 'Budget', key: 'budget', width: 28 },
  { header: 'Location', key: 'location', width: 28 },
  { header: 'Created By', key: 'createdBy', width: 24 },
  { header: 'Created At', key: 'createdAt', width: 24 },
  { header: 'Converted Date', key: 'convertedAt', width: 24 },
  { header: 'Source Lead', key: 'sourceLead', width: 26 },
  { header: 'Latest Note', key: 'latestNote', width: 50 },
  { header: 'Latest Note At', key: 'latestNoteAt', width: 24 },
  { header: 'Latest Interaction', key: 'latestInteraction', width: 50 },
  { header: 'Latest Interaction At', key: 'latestInteractionAt', width: 24 },
]

const formatContactBudgetForExport = (sourceLead: any): string => {
  if (!sourceLead) return ''
  const min = Number(sourceLead.budgetMin || 0)
  const max = Number(sourceLead.budgetMax || 0)
  if (!min && !max) return ''
  const currency = String(sourceLead.currency || 'BDT')
  const format = (value: number) => new Intl.NumberFormat('en-BD', { maximumFractionDigits: 0 }).format(value)
  if (min && max && min !== max) return `${currency} ${format(min)} - ${format(max)}`
  return `${currency} ${format(max || min)}`
}

const formatContactExportActivity = (activity?: { title?: string; content?: string; type?: string }): string => {
  if (!activity) return ''
  const label = String(activity.title || activity.type || 'CRM interaction').trim()
  const content = String(activity.content || '').trim()
  return content && content !== label ? `${label} — ${content}` : label
}

const getContactExportRows = async (
  organizationId: string,
  filters: IContactFilter,
  access?: CrmAccessContext,
): Promise<CrmExportRow[]> => {
  // buildContactWhere is shared with GET /contact. It includes tenant isolation,
  // assigned-to-me/team visibility and the active relationship filter.
  const where = buildContactWhere({ ...filters, organizationId }, access)
  const total = await Contact.countDocuments(where)
  if (total > MAX_EXPORT_ROWS) throw new ApiError(413, `Export contains more than ${MAX_EXPORT_ROWS.toLocaleString()} rows. Narrow the filters and retry.`)

  const contacts: any[] = await Contact.find(where)
    .populate(userRefPopulate('assignedTo', 'name email userRole'))
    .populate(userRefPopulate('createdBy', 'name email userRole'))
    .populate({
      path: 'sourceLeadId',
      select: 'name source leadStatus budgetMin budgetMax currency locationPreference propertyInterest',
      populate: { path: 'propertyInterest', select: 'title' },
    })
    .populate('propertyInterest', 'title')
    .sort({ updatedAt: -1, _id: -1 })
    .limit(MAX_EXPORT_ROWS)
    .select('name phone email type source statusAtConversion assignedTo followUpDate propertyInterest city address createdBy createdAt convertedAt sourceLeadId')
    .lean()

  const activity = await ActivityExportService.getContactExportActivityProjection(organizationId, contacts)
  return contacts.map((contact: any) => {
    const sourceLead = contact.sourceLeadId && typeof contact.sourceLeadId === 'object' ? contact.sourceLeadId : undefined
    const status = normalizeLeadStatus(contact.statusAtConversion || sourceLead?.leadStatus)
    const timeline = activity.get(String(contact._id))
    const propertyInterest = (contact.propertyInterest?.length ? contact.propertyInterest : sourceLead?.propertyInterest || [])
      .map((property: any) => property?.title || '')
      .filter(Boolean)
      .join('; ')
    return {
      name: contact.name,
      phone: contact.phone,
      email: contact.email || '',
      type: contact.type || '',
      source: contact.source || sourceLead?.source || '',
      status: status ? LEAD_STATUS_LABELS[status] : (sourceLead ? 'Converted' : 'Manual Contact'),
      assignee: contact.assignedTo?.name || '',
      followUpDate: contact.followUpDate || '',
      propertyInterest,
      budget: formatContactBudgetForExport(sourceLead),
      location: sourceLead?.locationPreference || contact.city || contact.address || '',
      createdBy: contact.createdBy?.name || '',
      createdAt: contact.createdAt || '',
      convertedAt: contact.convertedAt || '',
      sourceLead: sourceLead?.name || '',
      latestNote: timeline?.latestNote?.content || timeline?.latestNote?.title || '',
      latestNoteAt: timeline?.latestNote?.occurredAt || '',
      latestInteraction: formatContactExportActivity(timeline?.latestInteraction),
      latestInteractionAt: timeline?.latestInteraction?.occurredAt || '',
    }
  })
}

const exportCsv = async (organizationId: string, filters: IContactFilter, access?: CrmAccessContext) =>
  buildCrmCsv(CONTACT_EXPORT_COLUMNS, await getContactExportRows(organizationId, filters, access))

const exportXlsx = async (organizationId: string, filters: IContactFilter, access?: CrmAccessContext) =>
  buildCrmXlsx('Contacts', CONTACT_EXPORT_COLUMNS, await getContactExportRows(organizationId, filters, access))

export const ContactService = {
  createContact,
  getAllContacts,
  getContactById,
  updateContact,
  deleteContact,
  exportCsv,
  exportXlsx,
}
