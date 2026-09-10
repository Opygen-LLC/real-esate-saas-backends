import { z } from 'zod'
import { tenantIdSchema } from '../../helpers/inputSecurity'

const optionalHttpUrl = z.union([
  z.literal(''),
  z.string().trim().max(2048).url().refine((value) => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
  }, 'Referrer must use HTTP(S)'),
])

export const VisitorLogsValidation = {
  log: z.object({ body: z.object({
    organizationId: tenantIdSchema,
    urlPath: z.string().trim().min(1).max(2048).regex(/^\/(?!\/)/, 'URL path must be relative').optional(),
    referrer: optionalHttpUrl.optional(),
    device: z.string().trim().max(100).optional(),
    browser: z.string().trim().max(100).optional(),
    os: z.string().trim().max(100).optional(),
  }).strict() }),
}
