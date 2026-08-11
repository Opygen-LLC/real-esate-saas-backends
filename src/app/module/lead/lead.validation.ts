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
    currency: z.string().optional(),
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
    currency: z.string().optional(),
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
  updateLeadZodSchema,
  updateLeadStatusZodSchema,
}
