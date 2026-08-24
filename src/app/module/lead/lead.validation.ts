import { z } from 'zod'
import { bangladeshPhoneSchema, optionalEmailSchema } from '../../helpers/inputValidation'
import { LEAD_STATUS_VALUES, normalizeLeadStatus } from './leadStatus.contract'

const leadStatusSchema = z.preprocess((value: unknown) => normalizeLeadStatus(value) ?? value, z.enum(LEAD_STATUS_VALUES))
const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid user reference')

const attribution = z.object({
  utmSource: z.string().trim().max(120).optional(),
  utmMedium: z.string().trim().max(120).optional(),
  utmCampaign: z.string().trim().max(200).optional(),
  utmTerm: z.string().trim().max(200).optional(),
  utmContent: z.string().trim().max(200).optional(),
  referrer: z.string().trim().max(1000).optional(),
  landingPage: z.string().trim().max(1000).optional(),
}).strict().optional()

const leadFields = {
  name: z.string().trim().min(1, 'Name is required').max(120),
  phone: bangladeshPhoneSchema,
  email: optionalEmailSchema,
  source: z.enum(['Website', 'WhatsApp', 'Facebook', 'Instagram', 'Google', 'Referral', 'WalkIn', 'Portal', 'Phone', 'Email', 'Ad', 'Other']).optional(),
  budgetMin: z.number().nonnegative().optional(),
  budgetMax: z.number().nonnegative().optional(),
  currency: z.literal('BDT').optional(),
  propertyInterest: z.array(z.string()).max(100).optional(),
  locationPreference: z.string().trim().max(300).optional(),
  propertyType: z.string().trim().max(100).optional(),
  bedrooms: z.number().nonnegative().max(50).optional(),
  leadStatus: leadStatusSchema.optional(),
  assignedAgent: objectIdSchema.optional(),
  followUpDate: z.string().datetime().optional(),
  // Legacy request alias: accepted during rollout and normalized server-side to followUpDate.
  nextFollowUp: z.string().datetime().optional(),
  notes: z.string().trim().max(10000).optional(),
  lostReason: z.string().trim().max(120).optional(),
  attribution,
}

const createLeadBody = z.object(leadFields).strict().superRefine((value: any, ctx: z.RefinementCtx) => {
  if (value.leadStatus === 'FollowUpScheduled' && !value.followUpDate && !value.nextFollowUp) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['followUpDate'],
      message: 'Follow-up Scheduled requires a follow-up date and time',
    })
  }
})
const createLeadZodSchema = z.object({ body: createLeadBody })

const publicCaptureZodSchema = z.object({
  body: z.object({
    organizationId: z.string().trim().min(3).max(80),
    submissionContext: z.enum(['CONTACT', 'PROPERTY_ENQUIRY', 'GENERAL_LEAD']).optional(),
    name: leadFields.name,
    phone: leadFields.phone,
    email: leadFields.email,
    propertyInterest: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid property reference').optional(),
    message: z.string().trim().max(3000).optional(),
    budgetMin: leadFields.budgetMin,
    budgetMax: leadFields.budgetMax,
    propertyType: leadFields.propertyType,
    locationPreference: leadFields.locationPreference,
    privacyConsent: z.literal(true, { errorMap: () => ({ message: 'Privacy consent is required' }) }),
    policyVersion: z.string().trim().min(1, 'Privacy policy version is required').max(80),
    attribution,
  }).strict(),
})

const { leadStatus: _leadStatus, assignedAgent: _assignedAgent, followUpDate: _followUpDate, nextFollowUp: _nextFollowUp, lostReason: _lostReason, notes: _notes, ...genericEditableLeadFields } = leadFields
const updateLeadZodSchema = z.object({
  body: z.object({
    ...genericEditableLeadFields,
    name: leadFields.name.optional(),
    phone: leadFields.phone.optional(),
  }).partial().strict(),
})
const manageLeadBody = z.object({
  ...genericEditableLeadFields,
  name: leadFields.name.optional(),
  phone: leadFields.phone.optional(),
  leadStatus: leadStatusSchema.optional(),
  assignedAgent: objectIdSchema.optional(),
  followUpDate: z.string().datetime().optional(),
  lostReason: z.string().trim().max(120).optional(),
  reason: z.string().trim().max(500).optional(),
  followUpTitle: z.string().trim().min(1).max(200).optional(),
  followUpPriority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
}).partial().strict().superRefine((value, ctx) => {
  if (value.leadStatus === 'Lost' && !value.lostReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lostReason'],
      message: 'A lost reason is required when marking a Lead as Lost',
    })
  }
  if (!Object.keys(value).length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one Lead field is required' })
  }
})
const manageLeadZodSchema = z.object({ body: manageLeadBody })
const updateLeadStatusZodSchema = z.object({ body: z.object({ leadStatus: leadStatusSchema, lostReason: z.string().trim().max(120).optional(), reason: z.string().trim().max(500).optional() }).strict() })
const scheduleLeadFollowUpZodSchema = z.object({ body: z.object({ followUpDate: z.string().datetime(), title: z.string().trim().min(1).max(200).optional(), priority: z.enum(['low','medium','high','urgent']).optional(), reason: z.string().trim().max(500).optional() }).strict() })
const reengageLeadZodSchema = z.object({ body: z.object({ reason: z.string().trim().max(500).optional() }).strict() })
const assignLeadAgentZodSchema = z.object({
  body: z.object({
    assignedAgent: objectIdSchema,
    agentName: z.string().trim().max(120).optional(),
  }).strict(),
})
const confirmImportZodSchema = z.object({ body: z.object({ importSessionId: z.string().uuid('Invalid import session') }).strict() })

export const LeadValidation = { createLeadZodSchema, publicCaptureZodSchema, updateLeadZodSchema, manageLeadZodSchema, updateLeadStatusZodSchema, scheduleLeadFollowUpZodSchema, reengageLeadZodSchema, assignLeadAgentZodSchema, confirmImportZodSchema }
export type PublicLeadCaptureInput = z.infer<typeof publicCaptureZodSchema>['body']
export type ManageLeadInput = z.infer<typeof manageLeadBody>
