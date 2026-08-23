import { paidPlanIdSchema } from '../subscriptionPlan/subscriptionPlan.validation'
import { z } from 'zod'

const createPayment = z.object({
  body: z.object({
    planId: paidPlanIdSchema,
    billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  }),
})

const paymentStatus = z.object({
  params: z.object({ paymentId: z.string().min(3).max(128) }),
})

const manualReconcile = z.object({ params: z.object({ paymentId: z.string().min(3).max(128) }),
  body: z.object({ reason: z.string().trim().min(10).max(500) }) })
export const BkashPaymentValidation = { createPayment, paymentStatus, manualReconcile }
