import { z } from 'zod'
import { normalizeBangladeshPhone } from '../../helpers/identity'

const bdPhone = z.string().refine(value => { try { normalizeBangladeshPhone(value); return true } catch { return false } }, 'Enter a valid Bangladesh mobile number')
const password = z.string().min(10).max(128)
export const AuthValidation = {
  loginZodSchema: z.object({ body: z.object({ phoneNumber: bdPhone.optional(), email: z.string().email().optional(), password }).refine(v => v.phoneNumber || v.email, 'Email or phone is required') }),
  registerAgencyZodSchema: z.object({ body: z.object({ name: z.string().trim().min(2).max(100), email: z.string().email(), phoneNumber: bdPhone,
    password, agencyName: z.string().trim().min(2).max(120), agencyType: z.enum(['residential', 'commercial', 'mixed', 'brokerage', 'developer', 'general']).optional(), licenseNumber: z.string().trim().max(100).optional() }) }),
  verifyOtpZodSchema: z.object({ body: z.object({ phoneNumber: bdPhone, verificationCode: z.string().regex(/^\d{6}$/) }) }),
  phoneZodSchema: z.object({ body: z.object({ phoneNumber: bdPhone }) }),
  resetVerifyZodSchema: z.object({ body: z.object({ phoneNumber: bdPhone, verificationCode: z.string().regex(/^\d{6}$/) }) }),
  resetCompleteZodSchema: z.object({ body: z.object({ resetToken: z.string().min(32), newPassword: password }) }),
  changePasswordZodSchema: z.object({ body: z.object({ oldPassword: z.string().min(1), newPassword: password }) }),
}
