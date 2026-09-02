import { z } from 'zod'

export const LocalizationValidation = {
  locations: z.object({ query: z.object({
    level: z.enum(['division', 'district', 'upazila', 'area']),
    parentId: z.string().regex(/^\d+$/).optional(),
    locale: z.enum(['en', 'bn']).default('en'),
    search: z.string().trim().max(100).optional(),
  }) }),

  summary: z.object({ query: z.object({
    value: z.coerce.number().nonnegative(),
    from: z.enum(['sqft', 'decimal', 'shotok', 'katha', 'bigha', 'acre']),
    kathaSqft: z.coerce.number().positive().max(10000).optional(),
    bighaKatha: z.coerce.number().positive().max(100).optional(),
  }) }),
  convert: z.object({ query: z.object({
    value: z.coerce.number().nonnegative(),
    from: z.enum(['sqft', 'decimal', 'shotok', 'katha', 'bigha', 'acre']),
    to: z.enum(['sqft', 'decimal', 'shotok', 'katha', 'bigha', 'acre']),
    kathaSqft: z.coerce.number().positive().max(10000).optional(),
    bighaKatha: z.coerce.number().positive().max(100).optional(),
  }) }),
}
