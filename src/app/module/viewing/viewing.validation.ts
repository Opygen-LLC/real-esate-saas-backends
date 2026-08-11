import { z } from 'zod'

const createViewingZodSchema = z.object({
  body: z.object({
    propertyId: z.string({ required_error: 'Property is required' }),
    leadId: z.string().optional(),
    agentId: z.string({ required_error: 'Assigned agent is required' }),
    date: z.string({ required_error: 'Viewing date is required' }),
    startTime: z.string({ required_error: 'Start time is required' }),
    endTime: z.string({ required_error: 'End time is required' }),
    clientName: z.string({ required_error: 'Client name is required' }),
    clientPhone: z.string({ required_error: 'Client phone is required' }),
    clientEmail: z.string().email().optional().or(z.literal('')),
    status: z
      .enum(['Scheduled', 'Confirmed', 'Completed', 'Cancelled', 'NoShow', 'Rescheduled'])
      .optional(),
    notes: z.string().optional(),
  }),
})

const updateViewingZodSchema = z.object({
  body: z.object({
    propertyId: z.string().optional(),
    leadId: z.string().optional(),
    agentId: z.string().optional(),
    date: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    clientName: z.string().optional(),
    clientPhone: z.string().optional(),
    clientEmail: z.string().email().optional().or(z.literal('')),
    status: z
      .enum(['Scheduled', 'Confirmed', 'Completed', 'Cancelled', 'NoShow', 'Rescheduled'])
      .optional(),
    notes: z.string().optional(),
    feedback: z
      .object({
        interestLevel: z
          .enum(['Very High', 'Interested', 'Neutral', 'Not Interested'])
          .optional(),
        clientBudgetFeedback: z.string().optional(),
        notes: z.string().optional(),
      })
      .optional(),
  }),
})

const checkConflictZodSchema = z.object({
  body: z.object({
    agentId: z.string({ required_error: 'Agent ID is required' }),
    propertyId: z.string({ required_error: 'Property ID is required' }),
    date: z.string({ required_error: 'Date is required' }),
    startTime: z.string({ required_error: 'Start time is required' }),
    endTime: z.string({ required_error: 'End time is required' }),
    excludeViewingId: z.string().optional(),
  }),
})

export const ViewingValidation = {
  createViewingZodSchema,
  updateViewingZodSchema,
  checkConflictZodSchema,
}
