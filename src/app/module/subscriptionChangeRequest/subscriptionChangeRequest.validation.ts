import { z } from 'zod'

export const subscriptionChangeRequestInputSchema = z.object({
  organizationId: z.string().trim().min(3).max(80),
  currentPlan: z.enum(['trial', 'starter', 'professional', 'agency', 'enterprise']),
  currentPlanVersion: z.number().int().min(1),
  requestedPlan: z.enum(['starter', 'professional', 'agency', 'enterprise']),
  requestedPlanVersion: z.number().int().min(1),
  billingCycle: z.enum(['monthly', 'yearly']),
  amount: z.number().finite().nonnegative().max(1_000_000_000),
  currency: z.literal('BDT').default('BDT'),
  changeType: z.enum(['upgrade', 'downgrade', 'version_change']).optional(),
  requestedBy: z.string().trim().min(1).max(120),
}).strict().refine(
  value => value.currentPlan !== value.requestedPlan || value.currentPlanVersion !== value.requestedPlanVersion,
  { message: 'Requested subscription must differ from the current subscription', path: ['requestedPlan'] },
)

export const agencySubscriptionChangeRequestSchema = z.object({
  planId: z.enum(['starter', 'professional', 'agency', 'enterprise']),
  billingCycle: z.enum(['monthly', 'yearly']),
}).strict()
