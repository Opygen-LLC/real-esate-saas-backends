import { describe, expect, it } from 'vitest'
import { User } from '../../app/module/user/user.model'

describe('User secret serialization', () => {
  it('never serializes password or legacy OTP fields', () => {
    const user = new User({
      name: 'Safe User',
      email: 'safe@example.com',
      phoneNumber: '+8801712345678',
      password: 'hashed-password',
      organizationId: 'org_test',
      verificationCode: '123456',
      codeGenerationTimestamp: 'secret-time',
    })

    const json = user.toJSON() as Record<string, unknown>
    const object = user.toObject() as Record<string, unknown>

    for (const value of [json, object]) {
      expect(value.password).toBeUndefined()
      expect(value.verificationCode).toBeUndefined()
      expect(value.codeGenerationTimestamp).toBeUndefined()
      expect(value.email).toBe('safe@example.com')
    }
  })
})
