import { z } from 'zod'
import { objectIdSchema, tenantIdSchema } from '../../helpers/inputSecurity'

const icon = z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9]*$/, 'Invalid amenity icon')

export const AmenityValidation = {
  publicList: z.object({ params: z.object({ organizationId: tenantIdSchema }).strict() }),
  create: z.object({ body: z.object({
    name: z.string().trim().min(2).max(120),
    category: z.enum(['features', 'facilities', 'security', 'wellness', 'outdoor', 'eco']).optional(),
    icon: icon.optional(),
  }).strict() }),
  id: z.object({ params: z.object({ id: objectIdSchema }).strict() }),
}
