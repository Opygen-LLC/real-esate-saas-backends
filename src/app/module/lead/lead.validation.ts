import { z } from 'zod'
import { bangladeshPhoneSchema, optionalEmailSchema } from '../../helpers/inputValidation'

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
  leadStatus: z.string().trim().min(1).max(40).optional(),
  assignedAgent: z.string().optional(),
  contactId: z.string().optional(),
  nextFollowUp: z.string().datetime().optional(),
  notes: z.string().trim().max(10000).optional(),
  lostReason: z.string().trim().max(120).optional(),
  attribution,
}

const createLeadZodSchema = z.object({ body: z.object(leadFields).strict() })

const publicCaptureZodSchema = z.object({
  body: z.object({
    organizationId: z.string().trim().min(3).max(80),
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

const updateLeadZodSchema = z.object({ body: z.object({ ...leadFields, name: leadFields.name.optional(), phone: leadFields.phone.optional() }).partial().strict() })
const updateLeadStatusZodSchema = z.object({ body: z.object({ leadStatus: z.string().trim().min(1).max(40), lostReason: z.string().trim().max(120).optional() }).strict() })
const csvSchema = z.object({ body: z.object({ csv: z.string().min(1).max(5_000_000), mapping: z.record(z.string()).optional() }).strict() })

export const LeadValidation = { createLeadZodSchema, publicCaptureZodSchema, updateLeadZodSchema, updateLeadStatusZodSchema, csvSchema }
export type PublicLeadCaptureInput = z.infer<typeof publicCaptureZodSchema>['body']
