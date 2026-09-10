import { z } from 'zod'
import { normalizeBangladeshPhone } from '../../helpers/identity'
import { objectIdSchema } from '../../helpers/inputSecurity'

const bdPhone = z.string().refine(value => {
  try {
    normalizeBangladeshPhone(value)
    return true
  } catch {
    return false
  }
}, 'Enter a valid Bangladesh mobile number')

const loginPassword = z.string().min(1, 'Password is required')

export const strongPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')

const emailIdentity = z.string().trim().email('Enter a valid email address').max(254)

export const AuthValidation = {
  loginZodSchema: z.object({
    body: z
      .object({ phoneNumber: bdPhone.optional(), email: emailIdentity.optional(), password: loginPassword })
      .strict()
      .refine(v => v.phoneNumber || v.email, 'Email or phone is required'),
  }),
  registerAgencyZodSchema: z.object({
    body: z.object({
      name: z.string().trim().min(2).max(100),
      email: emailIdentity,
      phoneNumber: bdPhone,
      password: strongPasswordSchema,
      agencyName: z.string().trim().min(2).max(120),
      agencyType: z.enum(['residential', 'commercial', 'mixed', 'brokerage', 'developer', 'general']).optional(),
      licenseNumber: z.string().trim().max(100).optional(),
    }).strict(),
  }),
  verifyOtpZodSchema: z.object({ body: z.object({ email: emailIdentity, verificationCode: z.string().regex(/^\d{6}$/) }).strict() }),
  registrationContinuationZodSchema: z.object({
    body: z.object({ registrationContinuationToken: z.string().trim().min(32).max(256) }).strict(),
  }),
  emailZodSchema: z.object({ body: z.object({ email: emailIdentity }).strict() }),
  resetVerifyZodSchema: z.object({ body: z.object({ email: emailIdentity, verificationCode: z.string().regex(/^\d{6}$/) }).strict() }),
  resetCompleteZodSchema: z.object({ body: z.object({ resetToken: z.string().min(32), newPassword: strongPasswordSchema }).strict() }),
  changePasswordZodSchema: z.object({ body: z.object({ oldPassword: z.string().min(1), newPassword: strongPasswordSchema }).strict() }),
  sessionIdZodSchema: z.object({ params: z.object({ sessionId: objectIdSchema }).strict() }),
}
