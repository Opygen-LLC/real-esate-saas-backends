import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'
import { IPaginationOptions } from '../../../interfaces/common'
import paginationHelper from '../../helpers/paginationHelper'
import type { PublicLeadCaptureInput } from '../lead/lead.validation'
import type { PublicViewingRequestInput } from '../viewing/viewing.validation'
import {
  IWebsiteSubmission,
  WebsiteSubmissionFilter,
  WebsiteSubmissionStatus,
  WebsiteSubmissionType,
} from './websiteSubmission.interface'
import { WebsiteSubmission } from './websiteSubmission.model'

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

const createSubmission = async (payload: Omit<IWebsiteSubmission, 'status' | 'submittedAt'> & { submittedAt?: Date }) =>
  WebsiteSubmission.create({
    ...payload,
    status: 'NEW',
    submittedAt: payload.submittedAt || new Date(),
  })

const captureLead = async (payload: PublicLeadCaptureInput, lead: any) => {
  const landingPage = payload.attribution?.landingPage || ''
  return createSubmission({
    organizationId: payload.organizationId,
    submissionType: leadSubmissionType(payload),
    name: payload.name,
    email: String(lead?.email || payload.email || ''),
    phone: String(lead?.phone || payload.phone || ''),
    message: payload.message || '',
    propertyId: payload.propertyInterest || undefined,
    sourcePage: sourcePageFromLandingPage(landingPage, payload.propertyInterest ? '/properties' : ''),
    pageUrl: landingPage,
    linkedEntityType: 'Lead',
    linkedEntityId: lead._id,
    attribution: payload.attribution,
    privacyConsent: payload.privacyConsent,
    policyVersion: payload.policyVersion,
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
})

const parseBoundary = (value: string | undefined, field: string): Date | undefined => {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, `Invalid ${field}`)
  return parsed
}

const list = async (organizationId: string, filters: WebsiteSubmissionFilter, paginationOptions: IPaginationOptions) => {
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination({
    ...paginationOptions,
    sortBy: paginationOptions.sortBy || 'submittedAt',
    sortOrder: paginationOptions.sortOrder || 'desc',
    limit: paginationOptions.limit || 50,
  })

  const conditions: Record<string, unknown>[] = [{ organizationId }]
  if (filters.submissionType) conditions.push({ submissionType: filters.submissionType })
  if (filters.status) conditions.push({ status: filters.status })
  if (filters.propertyId) conditions.push({ propertyId: filters.propertyId })
  if (filters.sourcePage) conditions.push({ sourcePage: filters.sourcePage })

  if (filters.searchTerm) {
    const search = { $regex: escapeRegex(filters.searchTerm), $options: 'i' }
    conditions.push({ $or: [{ name: search }, { email: search }, { phone: search }, { message: search }, { sourcePage: search }] })
  }

  const submittedFrom = parseBoundary(filters.submittedFrom, 'submittedFrom')
  const submittedTo = parseBoundary(filters.submittedTo, 'submittedTo')
  if (submittedFrom && submittedTo && submittedFrom > submittedTo) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'submittedTo must be after submittedFrom')
  }
  if (submittedFrom || submittedTo) conditions.push({ submittedAt: { ...(submittedFrom ? { $gte: submittedFrom } : {}), ...(submittedTo ? { $lte: submittedTo } : {}) } })

  const where = { $and: conditions }
  const [rows, total] = await Promise.all([
    WebsiteSubmission.find(where)
      .populate({ path: 'propertyId', select: 'title slug address city images', match: { organizationId } })
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit)
      .lean(),
    WebsiteSubmission.countDocuments(where),
  ])

  return { meta: { page, limit, total }, data: rows }
}

const getById = async (organizationId: string, id: string) => {
  const submission = await WebsiteSubmission.findOne({ _id: id, organizationId })
    .populate({ path: 'propertyId', select: 'title slug address city images', match: { organizationId } })
    .lean()
  if (!submission) throw new ApiError(httpStatus.NOT_FOUND, 'Website submission not found')
  return submission
}

const updateStatus = async (organizationId: string, id: string, status: WebsiteSubmissionStatus) => {
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
    { _id: id, organizationId },
    { $set: set },
    { new: true, runValidators: true },
  ).populate({ path: 'propertyId', select: 'title slug address city images', match: { organizationId } })

  if (!submission) throw new ApiError(httpStatus.NOT_FOUND, 'Website submission not found')
  return submission
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
  linkedEntityId: String(linkedEntity?._id || linkedEntity?.id || submission.linkedEntityId),
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
  getById,
  updateStatus,
  toPublicReceipt,
  withPublicReceipt,
}
