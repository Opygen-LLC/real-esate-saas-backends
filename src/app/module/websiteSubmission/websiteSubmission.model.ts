import { Schema, model } from 'mongoose'
import {
  IWebsiteSubmission,
  WEBSITE_SUBMISSION_CRM_TRANSFER_OUTCOMES,
  WEBSITE_SUBMISSION_CRM_TRANSFER_STATUSES,
  WEBSITE_SUBMISSION_LINKED_ENTITY_TYPES,
  WEBSITE_SUBMISSION_STATUSES,
  WEBSITE_SUBMISSION_TYPES,
} from './websiteSubmission.interface'
import { CONSTRUCTION_STAGES, CONSTRUCTION_TYPES, DESIGN_REQUIREMENTS, INQUIRY_PROJECT_TYPES, INQUIRY_PURPOSES } from '../../shared/inquiryPurpose.contract'

const attributionSchema = new Schema(
  {
    utmSource: { type: String, trim: true, maxlength: 120 },
    utmMedium: { type: String, trim: true, maxlength: 120 },
    utmCampaign: { type: String, trim: true, maxlength: 200 },
    utmTerm: { type: String, trim: true, maxlength: 200 },
    utmContent: { type: String, trim: true, maxlength: 200 },
    referrer: { type: String, trim: true, maxlength: 1000 },
    landingPage: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false },
)

const inquiryProjectDetailsSchema = new Schema({
  projectType: { type: String, enum: INQUIRY_PROJECT_TYPES },
  landSize: { type: String, trim: true, maxlength: 120 },
  numberOfFloors: { type: Number, min: 1, max: 200 },
  approximateBuiltUpArea: { type: String, trim: true, maxlength: 120 },
  designRequirement: { type: String, enum: DESIGN_REQUIREMENTS },
  constructionType: { type: String, enum: CONSTRUCTION_TYPES },
  constructionStage: { type: String, enum: CONSTRUCTION_STAGES },
  expectedStartDate: { type: String, trim: true, maxlength: 10 },
  budgetRange: { type: String, trim: true, maxlength: 120 },
  location: { type: String, trim: true, maxlength: 300 },
}, { _id: false })

const websiteSubmissionSchema = new Schema<IWebsiteSubmission>(
  {
    organizationId: { type: String, required: true, trim: true, index: true },
    submissionType: { type: String, enum: WEBSITE_SUBMISSION_TYPES, required: true, index: true },
    status: { type: String, enum: WEBSITE_SUBMISSION_STATUSES, default: 'NEW', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200, default: '' },
    phone: { type: String, trim: true, maxlength: 40, default: '' },
    message: { type: String, trim: true, maxlength: 5000, default: '' },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', index: true },
    budgetMin: { type: Number, min: 0 },
    budgetMax: { type: Number, min: 0 },
    propertyType: { type: String, trim: true, maxlength: 100, default: '' },
    locationPreference: { type: String, trim: true, maxlength: 300, default: '' },
    inquiryPurpose: { type: String, enum: INQUIRY_PURPOSES, index: true },
    projectDetails: { type: inquiryProjectDetailsSchema, default: undefined },
    sourcePage: { type: String, trim: true, maxlength: 500, default: '' },
    pageUrl: { type: String, trim: true, maxlength: 1200, default: '' },
    linkedEntityType: { type: String, enum: WEBSITE_SUBMISSION_LINKED_ENTITY_TYPES, index: true },
    linkedEntityId: { type: Schema.Types.ObjectId, index: true },
    crmTransferStatus: {
      type: String,
      enum: WEBSITE_SUBMISSION_CRM_TRANSFER_STATUSES,
      default: function (this: any) {
        if (this.linkedEntityType === 'Lead' && this.linkedEntityId) return 'COMPLETED'
        if (this.linkedEntityType) return 'NOT_APPLICABLE'
        return 'PENDING'
      },
      required: true,
      index: true,
    },
    crmTransferOutcome: {
      type: String,
      enum: WEBSITE_SUBMISSION_CRM_TRANSFER_OUTCOMES,
      default: function (this: any) { return this.linkedEntityType === 'Lead' && this.linkedEntityId ? 'LEGACY' : undefined },
    },
    crmTransferStartedAt: { type: Date, default: null },
    movedToCrmAt: { type: Date, default: null, index: true },
    movedToCrmBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    crmTransferError: { type: String, trim: true, maxlength: 1000, default: '' },
    attribution: { type: attributionSchema, default: undefined },
    privacyConsent: { type: Boolean, default: undefined },
    policyVersion: { type: String, trim: true, maxlength: 80, default: '' },
    submittedAt: { type: Date, required: true, default: Date.now, index: true },
    readAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deleteReason: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true },
)

websiteSubmissionSchema.index({ organizationId: 1, submittedAt: -1 })
websiteSubmissionSchema.index({ organizationId: 1, status: 1, submittedAt: -1 })
websiteSubmissionSchema.index({ organizationId: 1, submissionType: 1, submittedAt: -1 })
websiteSubmissionSchema.index({ organizationId: 1, inquiryPurpose: 1, submittedAt: -1 })
websiteSubmissionSchema.index({ organizationId: 1, propertyId: 1, submittedAt: -1 })
websiteSubmissionSchema.index({ organizationId: 1, linkedEntityType: 1, linkedEntityId: 1, submittedAt: -1 })
websiteSubmissionSchema.index({ organizationId: 1, crmTransferStatus: 1, submittedAt: -1 })
websiteSubmissionSchema.index({ organizationId: 1, deletedAt: 1, submittedAt: -1 })
websiteSubmissionSchema.index({ organizationId: 1, deletedAt: 1, submittedAt: -1, _id: -1 }, { name: 'website_submission_tenant_deleted_submitted_cursor' })
websiteSubmissionSchema.index({ organizationId: 1, email: 1 }, { name: 'website_submission_tenant_email_exact' })
websiteSubmissionSchema.index({ organizationId: 1, phone: 1 }, { name: 'website_submission_tenant_phone_exact' })

export const WebsiteSubmission = model<IWebsiteSubmission>('WebsiteSubmission', websiteSubmissionSchema)
