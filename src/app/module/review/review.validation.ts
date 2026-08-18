import { z } from 'zod'
import { normalizeBangladeshPhone } from '../../helpers/identity'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Select a valid property')
const bdPhone = z.string().trim().refine((value) => { try { normalizeBangladeshPhone(value); return true } catch { return false } }, 'Enter a valid Bangladesh mobile number')

export const ReviewValidation = {
  createInvitation: z.object({ body: z.object({ propertyId: objectId, expiresInDays: z.number().int().min(1).max(90).optional() }).strict() }),
  submit: z.object({ body: z.object({
    token: z.string().min(32).max(200), name: z.string().trim().min(2).max(120), email: z.union([z.literal(''), z.string().email()]).optional(),
    phone: bdPhone, rating: z.number().int().min(1).max(5), comment: z.string().trim().min(3).max(2000),
  }).strict() }),
  moderate: z.object({ body: z.object({ status: z.enum(['pending', 'published', 'hidden']) }).strict() }),
}
