import { describe, expect, it } from 'vitest'
import { AuthValidation } from './auth.validation'

describe('AuthValidation login password compatibility', () => {
  it('accepts a legacy password shorter than the current registration minimum', () => {
    const result = AuthValidation.loginZodSchema.safeParse({
      body: { email: 'owner@example.com', password: 'legacy8!' },
    })

    expect(result.success).toBe(true)
  })

  it('still enforces the current password minimum for new registrations', () => {
    const result = AuthValidation.registerAgencyZodSchema.safeParse({
      body: {
        name: 'Agency Owner',
        email: 'owner@example.com',
        phoneNumber: '01712345678',
        password: 'legacy8!',
        agencyName: 'Example Realty',
        agencyType: 'residential',
      },
    })

    expect(result.success).toBe(false)
  })
})
