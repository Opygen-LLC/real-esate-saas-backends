import { z } from 'zod'
import { normalizeBangladeshPhone } from '../../helpers/identity'

const bdPhone = z.string().refine(value => {
  try {
    normalizeBangladeshPhone(value)
    return true
  } catch {
    return false
  }
}, 'Enter a valid Bangladesh mobile number')

const loginPassword = z.string().min(1, 'Password is required').max(128)

export const strongPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
  .regex(/[a-z]/, 'Password must include at least one lowercase letter')
  .regex(/[0-9]/, 'Password must include at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must include at least one special character')

const emailIdentity = z.string().trim().email('Enter a valid email address').max(254)

export const AuthValidation = {
  loginZodSchema: z.object({
    body: z
      .object({ phoneNumber: bdPhone.optional(), email: emailIdentity.optional(), password: loginPassword })
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
    }),
  }),
  verifyOtpZodSchema: z.object({ body: z.object({ email: emailIdentity, verificationCode: z.string().regex(/^\d{6}$/) }) }),
  emailZodSchema: z.object({ body: z.object({ email: emailIdentity }) }),
  resetVerifyZodSchema: z.object({ body: z.object({ email: emailIdentity, verificationCode: z.string().regex(/^\d{6}$/) }) }),
  resetCompleteZodSchema: z.object({ body: z.object({ resetToken: z.string().min(32), newPassword: strongPasswordSchema }) }),
  changePasswordZodSchema: z.object({ body: z.object({ oldPassword: z.string().min(1), newPassword: strongPasswordSchema }) }),
}
