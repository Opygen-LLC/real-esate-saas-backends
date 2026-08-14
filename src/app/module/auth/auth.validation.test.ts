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

  it('accepts an 8-character password when every complexity rule is met', () => {
    expect(AuthValidation.registerAgencyZodSchema.safeParse(registration('Abcd1!xy')).success).toBe(true)
  })

  it.each([
    ['short', 'Ab1!xyz'],
    ['uppercase', 'abcd1!xy'],
    ['lowercase', 'ABCD1!XY'],
    ['number', 'Abcdef!x'],
    ['special character', 'Abcdef1x'],
  ])('rejects a password missing the %s requirement', (_label, password) => {
    expect(strongPasswordSchema.safeParse(password).success).toBe(false)
  })

  it('uses email for account verification requests', () => {
    expect(AuthValidation.verifyOtpZodSchema.safeParse({ body: { email: 'owner@example.com', verificationCode: '123456' } }).success).toBe(true)
    expect(AuthValidation.verifyOtpZodSchema.safeParse({ body: { phoneNumber: '01712345678', verificationCode: '123456' } }).success).toBe(false)
  })
})
