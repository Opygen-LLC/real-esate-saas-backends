import { z } from 'zod'

const money = z.number().positive().max(100000000)
const wholeLeads = z.number().int().min(1).max(10000000)
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/)

const rateShape = z.object({
  name: z.string().trim().min(2).max(80),
  pricingMode: z.literal('rate'),
  leadsPerUnit: wholeLeads,
  pricePerUnit: money,
  currency: z.literal('BDT').default('BDT'),
  displayOrder: z.number().int().min(0).max(100000).default(0),
  isActive: z.boolean().default(true),
}).strict()

const packageShape = z.object({
  name: z.string().trim().min(2).max(80),
  pricingMode: z.literal('package'),
  packageLeads: wholeLeads,
  packagePrice: money,
  currency: z.literal('BDT').default('BDT'),
  displayOrder: z.number().int().min(0).max(100000).default(0),
  isActive: z.boolean().default(true),
}).strict()

export const leadTopupPricingCreateSchema = z.discriminatedUnion('pricingMode', [rateShape, packageShape])

export const LeadTopupPricingValidation = {
  create: z.object({ body: leadTopupPricingCreateSchema }),
  update: z.object({
    params: z.object({ id: objectId }),
    body: z.object({
      name: z.string().trim().min(2).max(80).optional(),
      pricingMode: z.enum(['rate', 'package']).optional(),
      leadsPerUnit: wholeLeads.nullable().optional(),
      pricePerUnit: money.nullable().optional(),
      packageLeads: wholeLeads.nullable().optional(),
      packagePrice: money.nullable().optional(),
      currency: z.literal('BDT').optional(),
      displayOrder: z.number().int().min(0).max(100000).optional(),
      isActive: z.boolean().optional(),
    }).strict().refine((value) => Object.keys(value).length > 0, 'At least one pricing field must change'),
  }),
  archive: z.object({
    params: z.object({ id: objectId }),
    body: z.object({ reason: z.string().trim().min(10).max(500) }),
  }),
}
