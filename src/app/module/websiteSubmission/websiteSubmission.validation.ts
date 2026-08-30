import { z } from 'zod'
import { WEBSITE_SUBMISSION_STATUSES, WEBSITE_SUBMISSION_TYPES } from './websiteSubmission.interface'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid reference')

const listQuery = z.object({
  query: z.object({
    searchTerm: z.string().trim().max(200).optional(),
    submissionType: z.enum(WEBSITE_SUBMISSION_TYPES).optional(),
    status: z.enum(WEBSITE_SUBMISSION_STATUSES).optional(),
    propertyId: objectId.optional(),
    sourcePage: z.string().trim().max(500).optional(),
    submittedFrom: z.string().datetime().optional(),
    submittedTo: z.string().datetime().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(250).optional(),
    sortBy: z.enum(['submittedAt', 'createdAt', 'updatedAt', 'status', 'submissionType']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  }).strict(),
})

const idParams = z.object({ params: z.object({ id: objectId }).strict() })

const deleteSubmission = z.object({
  params: z.object({ id: objectId }).strict(),
  body: z.object({ reason: z.string().trim().min(3).max(500).optional() }).strict().optional(),
})

const updateStatus = z.object({
  params: z.object({ id: objectId }).strict(),
  body: z.object({ status: z.enum(WEBSITE_SUBMISSION_STATUSES) }).strict(),
})

export const WebsiteSubmissionValidation = { listQuery, idParams, deleteSubmission, updateStatus }
