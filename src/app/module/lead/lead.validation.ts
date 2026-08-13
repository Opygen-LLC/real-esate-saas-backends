import { z } from 'zod'

const createLeadZodSchema = z.object({
  body: z.object({
    name: z.string({ required_error: 'Lead name is required' }),
    phone: z.string({ required_error: 'Phone number is required' }),
    email: z.string().email().optional().or(z.literal('')),
    source: z
      .enum([
        'Website',
        'WhatsApp',
        'Facebook',
        'Instagram',
        'Google',
        'Referral',
        'WalkIn',
        'Portal',
        'Phone',
        'Email',
        'Ad',
        'Other',
      ])
      .optional(),
    budgetMin: z.number().optional(),
    budgetMax: z.number().optional(),
    currency: z.literal('BDT').optional(),
    propertyInterest: z.array(z.string()).optional(),
    locationPreference: z.string().optional(),
    propertyType: z.string().optional(),
    bedrooms: z.number().optional(),
    leadStatus: z
      .enum([
        'New',
        'Contacted',
        'Qualified',
        'ViewingScheduled',
        'ViewingCompleted',
        'OfferMade',
        'Negotiation',
        'Won',
        'Lost',
      ])
      .optional(),
    assignedAgent: z.string().optional(),
    contactId: z.string().optional(),
    nextFollowUp: z.string().optional(),
    notes: z.string().optional(),
  }),
})

const publicCaptureZodSchema = z.object({ body: z.object({
  organizationId: z.string().trim().min(3).max(80), name: z.string().trim().min(2).max(100), phone: z.string().trim().min(11).max(30),
  email: z.string().email().optional().or(z.literal('')), propertyInterest: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  message: z.string().trim().max(3000).optional(), budgetMin: z.number().nonnegative().optional(), budgetMax: z.number().nonnegative().optional(),
  propertyType: z.string().max(80).optional(), locationPreference: z.string().max(200).optional(),
  privacyConsent: z.literal(true), policyVersion: z.string().trim().min(1).max(80),
}).strict() })

const updateLeadZodSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    source: z
      .enum([
        'Website',
        'WhatsApp',
        'Facebook',
        'Instagram',
        'Google',
        'Referral',
        'WalkIn',
        'Portal',
        'Phone',
        'Email',
        'Ad',
        'Other',
      ])
      .optional(),
    budgetMin: z.number().optional(),
    budgetMax: z.number().optional(),
    currency: z.literal('BDT').optional(),
    propertyInterest: z.array(z.string()).optional(),
    locationPreference: z.string().optional(),
    propertyType: z.string().optional(),
    bedrooms: z.number().optional(),
    leadStatus: z
      .enum([
        'New',
        'Contacted',
        'Qualified',
        'ViewingScheduled',
        'ViewingCompleted',
        'OfferMade',
        'Negotiation',
        'Won',
        'Lost',
      ])
      .optional(),
    assignedAgent: z.string().optional(),
    contactId: z.string().optional(),
    nextFollowUp: z.string().optional(),
    notes: z.string().optional(),
    lostReason: z.string().optional(),
  }),
})

const updateLeadStatusZodSchema = z.object({
  body: z.object({
    leadStatus: z.enum([
      'New',
      'Contacted',
      'Qualified',
      'ViewingScheduled',
      'ViewingCompleted',
      'OfferMade',
      'Negotiation',
      'Won',
      'Lost',
    ]),
    lostReason: z.string().optional(),
  }),
})

export const LeadValidation = {
  createLeadZodSchema,
  publicCaptureZodSchema,
  updateLeadZodSchema,
  updateLeadStatusZodSchema,
}
