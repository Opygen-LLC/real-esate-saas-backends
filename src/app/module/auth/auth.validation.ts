import { z } from 'zod'

const loginZodSchema = z.object({
  body: z.object({
    phoneNumber: z.string().optional(),
    email: z.string().optional(),
    password: z.string({
      required_error: 'Password is required',
    }),
  }),
})

const registerAgencyZodSchema = z.object({
  body: z.object({
    name: z.string({ required_error: 'Name is required' }),
    email: z.string({ required_error: 'Email is required' }).email(),
    phoneNumber: z.string({ required_error: 'Phone number is required' }),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    agencyName: z.string({ required_error: 'Agency name is required' }),
    agencyType: z.string().optional(),
    licenseNumber: z.string().optional(),
  }),
})

const refreshTokenZodSchema = z.object({
  body: z.object({
    refreshToken: z.string({
      required_error: 'Refresh token is required',
    }),
  }),
})

const changePasswordZodSchema = z.object({
  body: z.object({
    oldPassword: z.string({
      required_error: 'Old password is required',
    }),
    newPassword: z.string({
      required_error: 'New password is required',
    }),
  }),
})

export const AuthValidation = {
  loginZodSchema,
  registerAgencyZodSchema,
  refreshTokenZodSchema,
  changePasswordZodSchema,
}
