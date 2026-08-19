import { Schema, model } from 'mongoose'
import {
  IWebsiteSubmission,
  WEBSITE_SUBMISSION_LINKED_ENTITY_TYPES,
  WEBSITE_SUBMISSION_STATUSES,
  WEBSITE_SUBMISSION_TYPES,
} from './websiteSubmission.interface'

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
    sourcePage: { type: String, trim: true, maxlength: 500, default: '' },
    pageUrl: { type: String, trim: true, maxlength: 1200, default: '' },
    linkedEntityType: { type: String, enum: WEBSITE_SUBMISSION_LINKED_ENTITY_TYPES, required: true, index: true },
    linkedEntityId: { type: Schema.Types.ObjectId, required: true, index: true },
    attribution: { type: attributionSchema, default: undefined },
    privacyConsent: { type: Boolean, default: undefined },
    policyVersion: { type: String, trim: true, maxlength: 80, default: '' },
    submittedAt: { type: Date, required: true, default: Date.now, index: true },
    readAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

websiteSubmissionSchema.index({ organizationId: 1, submittedAt: -1 })
websiteSubmissionSchema.index({ organizationId: 1, status: 1, submittedAt: -1 })
websiteSubmissionSchema.index({ organizationId: 1, submissionType: 1, submittedAt: -1 })
websiteSubmissionSchema.index({ organizationId: 1, propertyId: 1, submittedAt: -1 })
websiteSubmissionSchema.index({ organizationId: 1, linkedEntityType: 1, linkedEntityId: 1, submittedAt: -1 })

export const WebsiteSubmission = model<IWebsiteSubmission>('WebsiteSubmission', websiteSubmissionSchema)
