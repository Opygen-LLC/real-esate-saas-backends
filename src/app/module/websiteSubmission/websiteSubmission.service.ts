import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import { finalizeCursorPage, parseDateCursorValue, prepareCursorPagination } from '../../helpers/cursorPagination'
import { createQueryProfile } from '../../helpers/queryPerformance'
import { normalizeBangladeshPhone } from '../../helpers/identity'
import type { CrmAccessContext } from '../crm/crmAccess'
import type { PublicLeadCaptureInput } from '../lead/lead.validation'
import { Lead } from '../lead/lead.model'
import { LeadService } from '../lead/lead.service'
import { TenantAccessService } from '../tenantAccess/tenantAccess.service'
import { Property } from '../property/property.model'
import { PrivacyConsentService } from '../privacy/privacyConsent.service'
import { PrivacyPolicyService } from '../privacy/privacyPolicy.service'
import { Viewing } from '../viewing/viewing.model'
import type { PublicViewingRequestInput } from '../viewing/viewing.validation'
import { RealtimeService } from '../realtime/realtime.service'
import {
  IWebsiteSubmission,
  WebsiteSubmissionFilter,
  WebsiteSubmissionStatus,
  WebsiteSubmissionType,
} from './websiteSubmission.interface'
import { WebsiteSubmission } from './websiteSubmission.model'
import { emitProductionEvent } from '../../../shared/productionEvents'
import { writeAudit } from '../audit/audit.service'
import { TenantPurgeBarrier } from '../compliance/tenantPurgeBarrier.service'
import { inquiryPurposeLabel } from '../../shared/inquiryPurpose.contract'

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const sourcePageFromLandingPage = (landingPage?: string, fallback = ''): string => {
  if (!landingPage) return fallback
  try {
    const parsed = new URL(landingPage, 'https://placeholder.invalid')
    return parsed.pathname || fallback
  } catch {
    const [path] = landingPage.split(/[?#]/)
    return path.startsWith('/') ? path : fallback
  }
}

const leadSubmissionType = (payload: PublicLeadCaptureInput): WebsiteSubmissionType => {
  // Property context is authoritative: a crafted client cannot label a property enquiry as a generic contact.
  if (payload.propertyInterest) return 'PROPERTY_ENQUIRY'
  if (payload.submissionContext === 'CONTACT') return 'CONTACT'
  if (payload.submissionContext === 'GENERAL_LEAD') return 'GENERAL_LEAD'

  // Backward-compatible inference for older website clients that do not send submissionContext yet.
  const page = sourcePageFromLandingPage(payload.attribution?.landingPage, '')
  if (page === '/contact' || page.endsWith('/contact')) return 'CONTACT'
  return 'GENERAL_LEAD'
}

const createSubmission = async (payload: Omit<IWebsiteSubmission, 'status' | 'submittedAt'> & { submittedAt?: Date }) => {
  await TenantPurgeBarrier.assertTenantWritable(payload.organizationId)
  const submission = await WebsiteSubmission.create({
    ...payload,
    status: 'NEW',
    submittedAt: payload.submittedAt || new Date(),
  })
  RealtimeService.emitOrganization(payload.organizationId, {
    type: 'website_submission.changed',
    action: 'created',
    entityId: submission._id.toString(),
    payload: payload.inquiryPurpose ? { inquiryPurpose: payload.inquiryPurpose, notificationTitle: `New ${inquiryPurposeLabel(payload.inquiryPurpose)} inquiry` } : undefined,
  })
  emitProductionEvent('website_submission_received', {
    organizationId: payload.organizationId,
    submissionId: submission._id.toString(),
    submissionType: payload.submissionType,
    crmTransferStatus: payload.crmTransferStatus || 'NOT_APPLICABLE',
    inquiryPurpose: payload.inquiryPurpose || null,
    notificationTitle: payload.inquiryPurpose ? `New ${inquiryPurposeLabel(payload.inquiryPurpose)} inquiry` : 'New website inquiry',
  })
  return submission
}

type PublicLeadSubmissionContext = { ip?: string; requestId?: string }

const captureLead = async (payload: PublicLeadCaptureInput, context: PublicLeadSubmissionContext) => {
  const { organizationId, privacyConsent, policyVersion } = payload
  await TenantAccessService.assertPublicWebsiteAccess(organizationId)
  await TenantPurgeBarrier.assertTenantWritable(organizationId)
  if (!privacyConsent) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Privacy consent is required', '', 'VALIDATION_ERROR', undefined, { privacyConsent: ['Privacy consent is required'] })
  }
  await PrivacyPolicyService.assertCurrentPublicPolicy(policyVersion)
  if (payload.propertyInterest) {
    const propertyBelongsToTenant = await Property.exists({ _id: payload.propertyInterest, organizationId })
    if (!propertyBelongsToTenant) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Property does not belong to this agency', '', 'VALIDATION_ERROR', undefined, { propertyInterest: ['Select a property from this agency'] })
    }
  }

  let normalizedPhone: string
  try {
    normalizedPhone = normalizeBangladeshPhone(payload.phone)
  } catch (error) {
    throw new ApiError(httpStatus.BAD_REQUEST, (error as Error).message, '', 'VALIDATION_ERROR', undefined, { phone: [(error as Error).message] })
  }

  // Consent belongs to the public submission lifecycle, not CRM conversion. A
  // lead may be moved hours or days later, but the visitor's consent must be
  // recorded at the time the website form is accepted.
  await PrivacyConsentService.recordPublicPrivacyPolicy(organizationId, normalizedPhone, policyVersion, context)

  const landingPage = payload.attribution?.landingPage || ''
  return createSubmission({
    organizationId,
    submissionType: leadSubmissionType(payload),
    name: payload.name,
    email: String(payload.email || ''),
    phone: normalizedPhone,
    message: payload.message || '',
    propertyId: payload.propertyInterest || undefined,
    budgetMin: payload.budgetMin,
    budgetMax: payload.budgetMax,
    propertyType: payload.propertyType || '',
    locationPreference: payload.locationPreference || '',
    inquiryPurpose: payload.inquiryPurpose,
    projectDetails: payload.projectDetails,
    sourcePage: sourcePageFromLandingPage(landingPage, payload.propertyInterest ? '/properties' : ''),
    pageUrl: landingPage,
    crmTransferStatus: 'PENDING',
    attribution: payload.attribution,
    privacyConsent,
    policyVersion,
  })
}

const captureViewing = async (payload: PublicViewingRequestInput, viewing: any) => {
  const landingPage = payload.attribution?.landingPage || ''
  return createSubmission({
    organizationId: payload.organizationId,
    submissionType: 'VIEWING',
    name: payload.clientName,
    email: String(viewing?.clientEmail || payload.clientEmail || ''),
    phone: String(viewing?.clientPhone || payload.clientPhone || ''),
    message: payload.notes || '',
    propertyId: payload.propertyId,
    sourcePage: sourcePageFromLandingPage(landingPage, '/properties'),
    pageUrl: landingPage,
    linkedEntityType: 'Viewing',
    linkedEntityId: viewing._id,
    crmTransferStatus: 'NOT_APPLICABLE',
    attribution: payload.attribution,
    privacyConsent: payload.privacyConsent,
    policyVersion: payload.policyVersion,
  })
}

const captureReview = async (review: any) => createSubmission({
  organizationId: String(review.organizationId),
  submissionType: 'REVIEW',
  name: String(review.name || 'Customer'),
  email: String(review.email || ''),
  phone: String(review.phone || ''),
  message: String(review.comment || ''),
  propertyId: review.propertyId || undefined,
  sourcePage: '/review',
  pageUrl: '',
  linkedEntityType: 'AgencyReview',
  linkedEntityId: review._id,
  crmTransferStatus: 'NOT_APPLICABLE',
})

const parseBoundary = (value: string | undefined, field: string): Date | undefined => {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${field}`)
  return parsed
}

type WebsiteSubmissionReadOptions = {
  includeLeadDetails?: boolean
  includeViewingDetails?: boolean
  crmAccess?: CrmAccessContext
}

const objectIdStrings = (rows: any[], type: 'Lead' | 'Viewing') => [...new Set(rows
  .filter((row) => row.linkedEntityType === type && row.linkedEntityId)
  .map((row) => String(row.linkedEntityId)))]

/**
 * Enriches submission rows with CRM metadata without ever crossing the tenant
 * boundary. The caller decides whether Lead/Viewing details are permitted for
 * the current user; the canonical linkedEntityId remains available regardless.
 */
const enrichLinkedRecords = async (
  organizationId: string,
  rows: any[],
  options: WebsiteSubmissionReadOptions = {},
) => {
  if (!rows.length) return rows

  const leadIds = options.includeLeadDetails ? objectIdStrings(rows, 'Lead') : []
  const viewingIds = options.includeViewingDetails ? objectIdStrings(rows, 'Viewing') : []
  const ownLeadScope = options.crmAccess?.scope === 'mine' ? { assignedAgent: options.crmAccess.userId } : {}
  const ownViewingScope = options.crmAccess?.scope === 'mine' ? { agentId: options.crmAccess.userId } : {}

  const [leads, viewings] = await Promise.all([
    leadIds.length
      ? Lead.find({ _id: { $in: leadIds }, organizationId, ...ownLeadScope })
        .select('_id name leadStatus assignedAgent isLocked lockReason')
        .populate({ path: 'assignedAgent', select: 'name email phoneNumber userRole', match: { organizationId } })
        .lean()
      : [],
    viewingIds.length
      ? Viewing.find({ _id: { $in: viewingIds }, organizationId, ...ownViewingScope })
        .select('_id status date startTime endTime leadId agentId')
        .populate({ path: 'agentId', select: 'name email phoneNumber userRole', match: { organizationId } })
        .lean()
      : [],
  ])

  const leadById = new Map(leads.map((lead: any) => [String(lead._id), lead]))
  const viewingById = new Map(viewings.map((viewing: any) => [String(viewing._id), viewing]))

  return rows.map((row) => {
    const linkedId = String(row.linkedEntityId || '')
    if (row.linkedEntityType === 'Lead' && options.includeLeadDetails) {
      const lead: any = leadById.get(linkedId)
      return {
        ...row,
        linkedRecord: {
          type: 'Lead',
          id: linkedId,
          available: Boolean(lead),
          ...(lead ? {
            lead: {
              _id: String(lead._id),
              name: lead.name,
              leadStatus: lead.leadStatus,
              isLocked: Boolean(lead.isLocked),
              lockReason: lead.lockReason,
              assignedAgent: lead.assignedAgent ? {
                _id: String(lead.assignedAgent._id),
                name: lead.assignedAgent.name,
                email: lead.assignedAgent.email,
                phoneNumber: lead.assignedAgent.phoneNumber,
                userRole: lead.assignedAgent.userRole,
              } : null,
            },
          } : {}),
        },
      }
    }
    if (row.linkedEntityType === 'Viewing' && options.includeViewingDetails) {
      const viewing: any = viewingById.get(linkedId)
      return {
        ...row,
        linkedRecord: {
          type: 'Viewing',
          id: linkedId,
          available: Boolean(viewing),
          ...(viewing ? {
            viewing: {
              _id: String(viewing._id),
              status: viewing.status,
              date: viewing.date,
              startTime: viewing.startTime,
              endTime: viewing.endTime,
              leadId: viewing.leadId ? String(viewing.leadId) : undefined,
              agent: viewing.agentId ? {
                _id: String(viewing.agentId._id),
                name: viewing.agentId.name,
                email: viewing.agentId.email,
                phoneNumber: viewing.agentId.phoneNumber,
                userRole: viewing.agentId.userRole,
              } : null,
            },
          } : {}),
        },
      }
    }
    return row
  })
}

const list = async (
  organizationId: string,
  filters: WebsiteSubmissionFilter,
  paginationOptions: IPaginationOptions,
  options: WebsiteSubmissionReadOptions = {},
) => {
  const profile = createQueryProfile('/api/v1/website-submissions', organizationId)
  const requestedSortBy = String(paginationOptions.sortBy || 'submittedAt')
  const requestedSortOrder = paginationOptions.sortOrder === 'asc' ? 'asc' : 'desc'
  if (paginationOptions.cursor && (requestedSortBy !== 'submittedAt' || requestedSortOrder !== 'desc')) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Website submission cursor pagination requires sortBy=submittedAt&sortOrder=desc')
  }
  const cursor = prepareCursorPagination({
    ...paginationOptions,
    sortBy: paginationOptions.cursor ? 'submittedAt' : (paginationOptions.sortBy || 'submittedAt'),
    sortOrder: paginationOptions.cursor ? 'desc' : (paginationOptions.sortOrder || 'desc'),
    limit: paginationOptions.limit || 50,
  }, { sortField: 'submittedAt', sortOrder: 'desc', parseValue: parseDateCursorValue })

  const conditions: Record<string, unknown>[] = [{ organizationId }, { deletedAt: null }]
  if (filters.submissionType) conditions.push({ submissionType: filters.submissionType })
  if (filters.status) conditions.push({ status: filters.status })
  if (filters.inquiryPurpose) conditions.push({ inquiryPurpose: filters.inquiryPurpose })
  if (filters.propertyId) conditions.push({ propertyId: filters.propertyId })
  if (filters.sourcePage) conditions.push({ sourcePage: filters.sourcePage })

  if (filters.searchTerm) {
    const raw = String(filters.searchTerm).trim()
    const escaped = escapeRegex(raw)
    if (raw.includes('@')) conditions.push({ email: raw.toLowerCase() })
    else if (/^[+()\d\s-]{6,30}$/.test(raw)) {
      let normalizedPhone = raw
      try { normalizedPhone = normalizeBangladeshPhone(raw) } catch { /* keep exact raw fallback */ }
      conditions.push({ $or: [{ phone: normalizedPhone }, { phone: raw }] })
    } else {
      const prefix = { $regex: `^${escaped}`, $options: 'i' }
      conditions.push({ $or: [{ name: prefix }, { sourcePage: prefix }, { message: prefix }, { inquiryPurpose: prefix }] })
    }
  }

  const submittedFrom = parseBoundary(filters.submittedFrom, 'submittedFrom')
  const submittedTo = parseBoundary(filters.submittedTo, 'submittedTo')
  if (submittedFrom && submittedTo && submittedFrom > submittedTo) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'submittedTo must be after submittedFrom')
  }
  if (submittedFrom || submittedTo) conditions.push({ submittedAt: { ...(submittedFrom ? { $gte: submittedFrom } : {}), ...(submittedTo ? { $lte: submittedTo } : {}) } })

  const baseWhere = { $and: conditions }
  const where = cursor.range ? { $and: [baseWhere, cursor.range] } : baseWhere
  const sortBy = cursor.cursorMode ? 'submittedAt' : cursor.sortBy
  const sortOrder = cursor.cursorMode ? -1 : cursor.sortOrder
  const [rows, total] = await profile.db(() => Promise.all([
    WebsiteSubmission.find(where)
      .populate({ path: 'propertyId', select: 'title slug address city images status', match: { organizationId } })
      .populate({ path: 'movedToCrmBy', select: 'name email', match: { organizationId } })
      .sort(paginationHelper.buildStableSort(sortBy, sortOrder))
      .skip(cursor.querySkip)
      .limit(cursor.queryLimit)
      .lean(),
    WebsiteSubmission.countDocuments(baseWhere),
  ]), 2)
  const page = finalizeCursorPage(rows as any[], cursor.limit, 'submittedAt', cursor.cursorMode)
  const data = await profile.db(() => enrichLinkedRecords(organizationId, page.rows, options), page.rows.length ? 2 : 0)
  profile.finish(data.length, { paginationMode: cursor.cursorMode ? 'cursor' : 'page' })

  return { meta: { page: cursor.page, limit: cursor.limit, total, nextCursor: page.nextCursor, hasMore: page.hasMore, paginationMode: cursor.cursorMode ? 'cursor' : 'page' }, data }
}

const inquiryPurposeAnalytics = async (organizationId: string) => {
  const rows = await WebsiteSubmission.aggregate([
    { $match: { organizationId, deletedAt: null, inquiryPurpose: { $exists: true, $ne: null } } },
    { $group: { _id: '$inquiryPurpose', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ])
  return rows.map((row) => ({ inquiryPurpose: row._id, label: inquiryPurposeLabel(row._id), count: row.count }))
}

const getById = async (organizationId: string, id: string, options: WebsiteSubmissionReadOptions = {}) => {
  const submission = await WebsiteSubmission.findOne({ _id: id, organizationId, deletedAt: null })
    .populate({ path: 'propertyId', select: 'title slug address city images status', match: { organizationId } })
    .populate({ path: 'movedToCrmBy', select: 'name email', match: { organizationId } })
    .lean()
  if (!submission) throw new ApiError(httpStatus.NOT_FOUND, 'Website submission not found')
  const [enriched] = await enrichLinkedRecords(organizationId, [submission], options)
  return enriched
}

const updateStatus = async (
  organizationId: string,
  id: string,
  status: WebsiteSubmissionStatus,
  options: WebsiteSubmissionReadOptions = {},
) => {
  const now = new Date()
  const set: Record<string, unknown> = { status }
  if (status === 'NEW') {
    set.readAt = null
    set.processedAt = null
  } else if (status === 'READ') {
    set.readAt = now
    set.processedAt = null
  } else if (status === 'PROCESSED') {
    set.readAt = now
    set.processedAt = now
  } else if (status === 'SPAM') {
    set.readAt = now
    set.processedAt = null
  }

  const submission = await WebsiteSubmission.findOneAndUpdate(
    { _id: id, organizationId, deletedAt: null },
    { $set: set },
    { new: true, runValidators: true },
  )
    .populate({ path: 'propertyId', select: 'title slug address city images status', match: { organizationId } })
    .populate({ path: 'movedToCrmBy', select: 'name email', match: { organizationId } })

  if (!submission) throw new ApiError(httpStatus.NOT_FOUND, 'Website submission not found')
  RealtimeService.emitOrganization(organizationId, {
    type: 'website_submission.changed',
    action: 'status_changed',
    entityId: submission._id.toString(),
  })
  const [enriched] = await enrichLinkedRecords(organizationId, [submission.toObject()], options)
  return enriched
}

export type WebsiteSubmissionActorContext = {
  id: string
  role?: string
  requestId?: string
  ip?: string
}

const deleteSubmission = async (
  organizationId: string,
  actor: WebsiteSubmissionActorContext,
  id: string,
  reason = 'Removed by agency owner',
) => {
  if (!actor.id) throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid authenticated user')
  const current: any = await WebsiteSubmission.findOne({ _id: id, organizationId, deletedAt: null }).lean()
  if (!current) throw new ApiError(httpStatus.NOT_FOUND, 'Website submission not found')
  if (current.crmTransferStatus === 'PROCESSING') {
    throw new ApiError(httpStatus.CONFLICT, 'This submission is currently being moved to CRM. Try again after the transfer finishes.')
  }

  const deletedAt = new Date()
  const updated: any = await WebsiteSubmission.findOneAndUpdate(
    { _id: id, organizationId, deletedAt: null, crmTransferStatus: { $ne: 'PROCESSING' } },
    { $set: { deletedAt, deletedBy: actor.id, deleteReason: reason.trim() } },
    { new: true, runValidators: true },
  ).lean()
  if (!updated) throw new ApiError(httpStatus.CONFLICT, 'Website submission state changed. Refresh and try again.')

  await writeAudit({
    organizationId,
    actorId: actor.id,
    actorRole: actor.role || 'tenant',
    action: 'website_submission.deleted',
    entityType: 'websiteSubmission',
    entityId: id,
    reason: updated.deleteReason || reason,
    requestId: actor.requestId,
    ip: actor.ip,
    metadata: {
      submissionType: updated.submissionType,
      status: updated.status,
      linkedEntityType: updated.linkedEntityType || null,
      linkedEntityId: updated.linkedEntityId ? String(updated.linkedEntityId) : null,
      crmTransferStatus: updated.crmTransferStatus,
    },
  })
  RealtimeService.emitOrganization(organizationId, {
    type: 'website_submission.changed',
    action: 'deleted',
    entityId: id,
  })
  emitProductionEvent('website_submission_deleted', {
    organizationId,
    submissionId: id,
    linkedEntityPreserved: Boolean(updated.linkedEntityId),
  })
  return { _id: updated._id, deletedAt: updated.deletedAt, linkedEntityPreserved: Boolean(updated.linkedEntityId) }
}

const LEAD_SUBMISSION_TYPES: WebsiteSubmissionType[] = ['CONTACT', 'PROPERTY_ENQUIRY', 'GENERAL_LEAD']
const CRM_TRANSFER_STALE_AFTER_MS = 2 * 60 * 1000
const LEAD_CAPACITY_CODES = new Set(['LEAD_ALLOWANCE_EXHAUSTED', 'TRIAL_LIMIT_REACHED', 'PLAN_LIMIT_REACHED'])
const LEAD_ACCESS_INACTIVE_CODES = new Set(['LEAD_BENEFIT_PERIOD_INACTIVE', 'SUBSCRIPTION_INACTIVE'])

const transferStatusOf = (submission: any) => {
  if (submission.crmTransferStatus) return String(submission.crmTransferStatus)
  if (submission.linkedEntityType === 'Lead' && submission.linkedEntityId) return 'COMPLETED'
  return LEAD_SUBMISSION_TYPES.includes(submission.submissionType) ? 'PENDING' : 'NOT_APPLICABLE'
}

const moveToCrm = async (
  organizationId: string,
  id: string,
  actorId: string | undefined,
  access: CrmAccessContext,
  options: WebsiteSubmissionReadOptions = {},
) => {
  const current: any = await WebsiteSubmission.findOne({ _id: id, organizationId, deletedAt: null }).lean()
  if (!current) throw new ApiError(httpStatus.NOT_FOUND, 'Website submission not found')
  if (!LEAD_SUBMISSION_TYPES.includes(current.submissionType)) {
    throw new ApiError(httpStatus.CONFLICT, 'Only lead-like website submissions can be moved to CRM', '', 'CRM_TRANSFER_NOT_APPLICABLE')
  }
  if (current.status === 'SPAM') {
    throw new ApiError(httpStatus.CONFLICT, 'Mark this submission as New or Read before moving it to CRM', '', 'CRM_TRANSFER_SPAM_BLOCKED')
  }

  const currentTransferStatus = transferStatusOf(current)
  if (currentTransferStatus === 'COMPLETED' && current.linkedEntityType === 'Lead' && current.linkedEntityId) {
    return {
      submission: await getById(organizationId, id, options),
      outcome: current.crmTransferOutcome || 'LEGACY',
      leadId: String(current.linkedEntityId),
      alreadyMoved: true,
    }
  }

  const now = new Date()
  const staleBefore = new Date(now.getTime() - CRM_TRANSFER_STALE_AFTER_MS)
  const claim: any = await WebsiteSubmission.findOneAndUpdate(
    {
      _id: id,
      organizationId,
      deletedAt: null,
      submissionType: { $in: LEAD_SUBMISSION_TYPES },
      $or: [
        { crmTransferStatus: { $in: ['PENDING', 'FAILED'] } },
        { crmTransferStatus: { $exists: false }, linkedEntityId: { $exists: false } },
        { $and: [
          { crmTransferStatus: 'PROCESSING' },
          { $or: [{ crmTransferStartedAt: { $lt: staleBefore } }, { crmTransferStartedAt: null }, { crmTransferStartedAt: { $exists: false } }] },
        ] },
      ],
    },
    {
      $set: {
        crmTransferStatus: 'PROCESSING',
        crmTransferStartedAt: now,
        crmTransferError: '',
      },
    },
    { new: true, runValidators: true },
  ).lean()

  if (!claim) {
    const latest: any = await WebsiteSubmission.findOne({ _id: id, organizationId, deletedAt: null }).lean()
    if (latest && transferStatusOf(latest) === 'COMPLETED' && latest.linkedEntityId) {
      return {
        submission: await getById(organizationId, id, options),
        outcome: latest.crmTransferOutcome || 'LEGACY',
        leadId: String(latest.linkedEntityId),
        alreadyMoved: true,
      }
    }
    throw new ApiError(httpStatus.CONFLICT, 'This submission is already being moved to CRM. Please refresh in a moment.', '', 'CRM_TRANSFER_IN_PROGRESS')
  }

  try {
    const result = await LeadService.createLeadWithOutcome(
      organizationId,
      {
        name: claim.name,
        phone: claim.phone,
        email: claim.email || undefined,
        source: 'Website',
        propertyInterest: claim.propertyId ? [String(claim.propertyId)] : [],
        budgetMin: claim.budgetMin,
        budgetMax: claim.budgetMax,
        propertyType: claim.propertyType || undefined,
        locationPreference: claim.locationPreference || undefined,
        inquiryPurpose: claim.inquiryPurpose || undefined,
        projectDetails: claim.projectDetails || undefined,
        notes: claim.message || '',
        attribution: claim.attribution || undefined,
      },
      actorId,
      access,
      { allowanceSource: 'website' },
    )

    const outcome = result.outcome === 'merged' ? 'MERGED' : 'CREATED'
    const completedAt = new Date()
    const updated = await WebsiteSubmission.findOneAndUpdate(
      { _id: id, organizationId, deletedAt: null, crmTransferStatus: 'PROCESSING' },
      {
        $set: {
          linkedEntityType: 'Lead',
          linkedEntityId: (result.lead as any)._id,
          crmTransferStatus: 'COMPLETED',
          crmTransferOutcome: outcome,
          crmTransferStartedAt: null,
          movedToCrmAt: completedAt,
          movedToCrmBy: actorId || null,
          crmTransferError: '',
          status: 'PROCESSED',
          readAt: completedAt,
          processedAt: completedAt,
        },
      },
      { new: true, runValidators: true },
    )
    if (!updated) throw new ApiError(httpStatus.CONFLICT, 'Website submission CRM transfer state changed unexpectedly', '', 'CRM_TRANSFER_STATE_CONFLICT')

    RealtimeService.emitOrganization(organizationId, {
      type: 'website_submission.changed',
      action: outcome === 'MERGED' ? 'crm_merged' : 'crm_created',
      entityId: id,
    })
    emitProductionEvent(outcome === 'MERGED' ? 'website_submission_crm_merged' : 'website_submission_moved_to_crm', {
      organizationId,
      submissionId: id,
      leadId: String((result.lead as any)._id),
      outcome,
    })

    return {
      submission: await getById(organizationId, id, options),
      outcome,
      leadId: String((result.lead as any)._id),
      assignedAgent: result.assignedAgent,
      alreadyMoved: false,
    }
  } catch (error: any) {
    const code = String(error?.code || '')
    const capacityBlocked = LEAD_CAPACITY_CODES.has(code)
    const accessInactive = LEAD_ACCESS_INACTIVE_CODES.has(code)
    const nextStatus = capacityBlocked || accessInactive ? 'PENDING' : 'FAILED'
    const safeError = String(error?.message || 'Unable to move submission to CRM').slice(0, 1000)
    await WebsiteSubmission.updateOne(
      { _id: id, organizationId, deletedAt: null, crmTransferStatus: 'PROCESSING' },
      { $set: { crmTransferStatus: nextStatus, crmTransferStartedAt: null, crmTransferError: safeError } },
    )
    RealtimeService.emitOrganization(organizationId, {
      type: 'website_submission.changed',
      action: 'crm_move_failed',
      entityId: id,
    })
    emitProductionEvent('website_submission_crm_failed', {
      organizationId,
      submissionId: id,
      errorCode: code || 'CRM_TRANSFER_FAILED',
      preserved: capacityBlocked || accessInactive,
      nextStatus,
    }, capacityBlocked || accessInactive ? 'warn' : 'error')

    if (capacityBlocked) {
      throw new ApiError(
        Number(error?.statusCode) || httpStatus.CONFLICT,
        'Your CRM lead capacity is full. This website submission has been kept safely in your Website Submissions inbox.',
        '',
        code || 'LEAD_ALLOWANCE_EXHAUSTED',
        { ...(error?.details || {}), submissionId: id, submissionPreserved: true },
        error?.fieldErrors,
      )
    }
    throw error
  }
}

const toPublicReceipt = (submission: any, linkedEntity: any) => ({
  submissionId: String(submission._id),
  submissionType: submission.submissionType === 'VIEWING'
    ? 'viewing'
    : submission.submissionType === 'REVIEW'
      ? 'review'
      : submission.submissionType === 'CONTACT'
        ? 'contact'
        : 'lead',
  status: 'received' as const,
  submittedAt: new Date(submission.submittedAt || submission.createdAt || Date.now()).toISOString(),
  ...(linkedEntity?._id || linkedEntity?.id || submission.linkedEntityId ? { linkedEntityId: String(linkedEntity?._id || linkedEntity?.id || submission.linkedEntityId) } : {}),
  ...(submission.crmTransferStatus ? { crmTransferStatus: submission.crmTransferStatus } : {}),
})

const withPublicReceipt = (linkedEntity: any, submission: any) => {
  const plain = typeof linkedEntity?.toObject === 'function' ? linkedEntity.toObject() : linkedEntity
  return { ...plain, submission: toPublicReceipt(submission, linkedEntity) }
}

export const WebsiteSubmissionService = {
  captureLead,
  captureViewing,
  captureReview,
  list,
  inquiryPurposeAnalytics,
  getById,
  updateStatus,
  deleteSubmission,
  moveToCrm,
  toPublicReceipt,
  withPublicReceipt,
}
