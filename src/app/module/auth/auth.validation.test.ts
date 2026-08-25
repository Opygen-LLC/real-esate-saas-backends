import { describe, expect, it } from 'vitest'
import { AuthValidation, strongPasswordSchema } from './auth.validation'

const registration = (password: string) => ({
  body: {
    name: 'Agency Owner',
    email: 'owner@example.com',
    phoneNumber: '01712345678',
    password,
    agencyName: 'Example Realty',
    agencyType: 'residential',
  },
})

describe('AuthValidation password policy', () => {
  it('keeps login compatible with existing passwords', () => {
    expect(AuthValidation.loginZodSchema.safeParse({ body: { email: 'owner@example.com', password: 'legacy8!' } }).success).toBe(true)
  })

  it('accepts any password with at least 8 characters', () => {
    for (const password of ['abcdefgh', '12345678', '!!!!!!!!', 'password', 'Abcd1!xy']) {
      expect(AuthValidation.registerAgencyZodSchema.safeParse(registration(password)).success).toBe(true)
      expect(strongPasswordSchema.safeParse(password).success).toBe(true)
    }
  })

  it('rejects passwords shorter than 8 characters', () => {
    expect(strongPasswordSchema.safeParse('1234567').success).toBe(false)
  })

  it('applies the same minimum length to password reset and change-password', () => {
    expect(AuthValidation.resetCompleteZodSchema.safeParse({ body: { resetToken: 'x'.repeat(32), newPassword: 'abcdefgh' } }).success).toBe(true)
    expect(AuthValidation.resetCompleteZodSchema.safeParse({ body: { resetToken: 'x'.repeat(32), newPassword: '1234567' } }).success).toBe(false)
    expect(AuthValidation.changePasswordZodSchema.safeParse({ body: { oldPassword: 'current', newPassword: 'abcdefgh' } }).success).toBe(true)
    expect(AuthValidation.changePasswordZodSchema.safeParse({ body: { oldPassword: 'current', newPassword: '1234567' } }).success).toBe(false)
  })

  it('uses email for account verification requests', () => {
    expect(AuthValidation.verifyOtpZodSchema.safeParse({ body: { email: 'owner@example.com', verificationCode: '123456' } }).success).toBe(true)
    expect(AuthValidation.verifyOtpZodSchema.safeParse({ body: { phoneNumber: '01712345678', verificationCode: '123456' } }).success).toBe(false)
  })
})
