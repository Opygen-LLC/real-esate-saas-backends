import { z } from 'zod'
import {
  addAppointmentWindowValidation,
  appointmentDateSchema,
  appointmentTimeSchema,
  bangladeshPhoneSchema,
  optionalEmailSchema,
} from '../../helpers/inputValidation'

const statusSchema = z.enum(['Scheduled', 'Confirmed', 'Completed', 'Cancelled', 'NoShow', 'Rescheduled'])

const attribution = z.object({
  utmSource: z.string().trim().max(120).optional(),
  utmMedium: z.string().trim().max(120).optional(),
  utmCampaign: z.string().trim().max(200).optional(),
  utmTerm: z.string().trim().max(200).optional(),
  utmContent: z.string().trim().max(200).optional(),
  referrer: z.string().trim().max(1000).optional(),
  landingPage: z.string().trim().max(1000).optional(),
}).strict().optional()

const completeAppointmentBody = z.object({
  propertyId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid property reference'),
  agentId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid agent reference'),
  leadId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  date: appointmentDateSchema,
  startTime: appointmentTimeSchema,
  endTime: appointmentTimeSchema,
  clientName: z.string().trim().min(1, 'Client name is required').max(120),
  clientPhone: bangladeshPhoneSchema,
  clientEmail: optionalEmailSchema,
  status: statusSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict()

const createViewingZodSchema = z.object({ body: addAppointmentWindowValidation(completeAppointmentBody) })

const updateViewingZodSchema = z.object({
  body: z.object({
    propertyId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
    agentId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
    leadId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
    date: appointmentDateSchema.optional(),
    startTime: appointmentTimeSchema.optional(),
    endTime: appointmentTimeSchema.optional(),
    clientName: z.string().trim().min(1).max(120).optional(),
    clientPhone: bangladeshPhoneSchema.optional(),
    clientEmail: optionalEmailSchema,
    status: statusSchema.optional(),
    notes: z.string().trim().max(2000).optional(),
    feedback: z.object({
      interestLevel: z.enum(['Very High', 'Interested', 'Neutral', 'Not Interested']).optional(),
      clientBudgetFeedback: z.string().trim().max(1000).optional(),
      notes: z.string().trim().max(2000).optional(),
    }).strict().optional(),
  }).strict(),
})

const checkConflictZodSchema = z.object({
  body: addAppointmentWindowValidation(z.object({
    agentId: z.string().regex(/^[0-9a-fA-F]{24}$/),
    propertyId: z.string().regex(/^[0-9a-fA-F]{24}$/),
    date: appointmentDateSchema,
    startTime: appointmentTimeSchema,
    endTime: appointmentTimeSchema,
    excludeViewingId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  }).strict()),
})

const publicRequestZodSchema = z.object({
  body: addAppointmentWindowValidation(z.object({
    organizationId: z.string().trim().min(3).max(80),
    propertyId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid property reference'),
    date: appointmentDateSchema,
    startTime: appointmentTimeSchema,
    endTime: appointmentTimeSchema,
    clientName: z.string().trim().min(1, 'Name is required').max(120),
    clientPhone: bangladeshPhoneSchema,
    clientEmail: optionalEmailSchema,
    notes: z.string().trim().max(2000).optional(),
    privacyConsent: z.literal(true, { errorMap: () => ({ message: 'Privacy consent is required' }) }),
    policyVersion: z.string().trim().min(1, 'Privacy policy version is required').max(80),
    attribution,
  }).strict()),
})

export const ViewingValidation = {
  createViewingZodSchema,
  updateViewingZodSchema,
  checkConflictZodSchema,
  publicRequestZodSchema,
}

export type PublicViewingRequestInput = z.infer<typeof publicRequestZodSchema>['body']
