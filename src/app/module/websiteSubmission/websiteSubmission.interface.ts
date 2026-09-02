import type mongoose from 'mongoose'
import type { InquiryProjectDetails, InquiryPurpose } from '../../shared/inquiryPurpose.contract'

export const WEBSITE_SUBMISSION_TYPES = [
  'CONTACT',
  'PROPERTY_ENQUIRY',
  'VIEWING',
  'REVIEW',
  'GENERAL_LEAD',
] as const

export const WEBSITE_SUBMISSION_STATUSES = ['NEW', 'READ', 'PROCESSED', 'SPAM'] as const
export const WEBSITE_SUBMISSION_LINKED_ENTITY_TYPES = ['Lead', 'Viewing', 'AgencyReview'] as const
export const WEBSITE_SUBMISSION_CRM_TRANSFER_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'NOT_APPLICABLE'] as const
export const WEBSITE_SUBMISSION_CRM_TRANSFER_OUTCOMES = ['CREATED', 'MERGED', 'LEGACY'] as const

export type WebsiteSubmissionType = (typeof WEBSITE_SUBMISSION_TYPES)[number]
export type WebsiteSubmissionStatus = (typeof WEBSITE_SUBMISSION_STATUSES)[number]
export type WebsiteSubmissionLinkedEntityType = (typeof WEBSITE_SUBMISSION_LINKED_ENTITY_TYPES)[number]
export type WebsiteSubmissionCrmTransferStatus = (typeof WEBSITE_SUBMISSION_CRM_TRANSFER_STATUSES)[number]
export type WebsiteSubmissionCrmTransferOutcome = (typeof WEBSITE_SUBMISSION_CRM_TRANSFER_OUTCOMES)[number]

export type WebsiteSubmissionAttribution = {
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
  referrer?: string
  landingPage?: string
}

export interface IWebsiteSubmission {
  organizationId: string
  submissionType: WebsiteSubmissionType
  status: WebsiteSubmissionStatus
  name: string
  email?: string
  phone?: string
  message?: string
  propertyId?: mongoose.Types.ObjectId | string
  budgetMin?: number
  budgetMax?: number
  propertyType?: string
  locationPreference?: string
  inquiryPurpose?: InquiryPurpose
  projectDetails?: InquiryProjectDetails
  sourcePage?: string
  pageUrl?: string
  linkedEntityType?: WebsiteSubmissionLinkedEntityType
  linkedEntityId?: mongoose.Types.ObjectId | string
  crmTransferStatus: WebsiteSubmissionCrmTransferStatus
  crmTransferOutcome?: WebsiteSubmissionCrmTransferOutcome
  crmTransferStartedAt?: Date | null
  movedToCrmAt?: Date | null
  movedToCrmBy?: mongoose.Types.ObjectId | string | null
  crmTransferError?: string
  attribution?: WebsiteSubmissionAttribution
  privacyConsent?: boolean
  policyVersion?: string
  submittedAt: Date
  readAt?: Date | null
  processedAt?: Date | null
  deletedAt?: Date | null
  deletedBy?: mongoose.Types.ObjectId | string | null
  deleteReason?: string
  createdAt?: Date
  updatedAt?: Date
}

export type WebsiteSubmissionFilter = {
  searchTerm?: string
  submissionType?: WebsiteSubmissionType
  status?: WebsiteSubmissionStatus
  inquiryPurpose?: InquiryPurpose
  propertyId?: string
  sourcePage?: string
  submittedFrom?: string
  submittedTo?: string
}
