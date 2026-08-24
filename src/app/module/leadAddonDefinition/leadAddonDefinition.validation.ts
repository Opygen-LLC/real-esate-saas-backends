import { z } from 'zod'
import { paidPlanIdSchema } from '../subscriptionPlan/subscriptionPlan.validation'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/)
const body = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().toLowerCase().min(3).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  leadCapacity: z.number().int().min(1).max(10_000_000),
  priceMonthly: z.number().positive().max(100_000_000),
  currency: z.literal('BDT').default('BDT'),
  eligiblePlans: z.array(paidPlanIdSchema).min(1).max(100),
  displayOrder: z.number().int().min(0).max(100_000).default(0),
  isActive: z.boolean().default(true),
  reason: z.string().trim().min(10).max(500),
}).strict()

export const LeadAddonDefinitionValidation = {
  create: z.object({ body }),
  update: z.object({
    params: z.object({ id: objectId }),
    body: body.partial().omit({ slug: true }).extend({ reason: z.string().trim().min(10).max(500) }).strict().refine((value) => Object.keys(value).some((key) => key !== 'reason'), 'At least one add-on field must change'),
  }),
  archive: z.object({ params: z.object({ id: objectId }), body: z.object({ reason: z.string().trim().min(10).max(500) }) }),
}
