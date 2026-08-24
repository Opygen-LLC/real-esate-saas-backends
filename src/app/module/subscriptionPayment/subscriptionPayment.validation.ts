import { paidPlanIdSchema } from '../subscriptionPlan/subscriptionPlan.validation'
import { z } from 'zod'

export const subscriptionPaymentInputSchema = z.object({
  organizationId: z.string().trim().min(3).max(80),
  changeRequestId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  planId: paidPlanIdSchema.optional(),
  planVersion: z.number().int().min(1).optional(),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
  method: z.enum(['cash', 'bank', 'bkash', 'nagad', 'other']),
  reference: z.string().trim().max(200).optional(),
  paidAt: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
  proofAssetId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  reason: z.string().trim().min(10).max(1000),
}).strict().superRefine((value, ctx) => {
  if (!value.changeRequestId && !value.planId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['planId'], message: 'Plan is required when no change request is supplied' })
  }
  if (value.method !== 'cash' && (!value.reference || value.reference.trim().length < 3)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reference'], message: 'A payment reference is required for non-cash payments' })
  }
})

export const subscriptionPaymentDecisionSchema = z.object({
  status: z.enum(['confirmed', 'rejected']),
  reason: z.string().trim().min(10).max(1000),
}).strict()
