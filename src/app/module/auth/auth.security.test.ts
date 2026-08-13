import { describe, expect, it } from 'vitest'
import { hashOtp } from '../../helpers/crypto'
import { normalizeBangladeshPhone } from '../../helpers/identity'
import { validateOtpChallengeState } from './auth.services'
import { AuthValidation } from './auth.validation'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const valid = () => ({ expiresAt: new Date(Date.now() + 60_000), consumedAt: null, attempts: 0, maxAttempts: 5 })

describe('OTP and reset security', () => {
  it('rejects expired OTP challenges', () => {
    expect(() => validateOtpChallengeState({ ...valid(), expiresAt: new Date(Date.now() - 1) })).toThrow(/expired/i)
  })
  it('rejects challenges after the maximum attempt count', () => {
    expect(() => validateOtpChallengeState({ ...valid(), attempts: 5 })).toThrow(/maximum/i)
  })
  it('prevents OTP replay after consumption', () => {
    expect(() => validateOtpChallengeState({ ...valid(), consumedAt: new Date() })).toThrow(/already been used/i)
  })
  it('stores a keyed OTP hash instead of the OTP', () => {
    expect(hashOtp('challenge-id', '123456')).not.toContain('123456')
    expect(hashOtp('challenge-id', '123456')).toHaveLength(64)
  })
  it('does not allow phone plus password to reset an account anonymously', () => {
    const result = AuthValidation.resetCompleteZodSchema.safeParse({ body: { phoneNumber: '01712345678', newPassword: 'Secure-pass-123' } })
    expect(result.success).toBe(false)
  })
  it('normalizes Bangladesh phone identities to E.164', () => {
    expect(normalizeBangladeshPhone('01712-345678')).toBe('+8801712345678')
    expect(normalizeBangladeshPhone('8801712345678')).toBe('+8801712345678')
  })
  it('fails startup instead of using fallback secrets in production', () => {
    const result = spawnSync(process.execPath, ['-e', "require('./dist/config')"], {
      cwd: path.resolve(__dirname, '../../../..'),
      env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: '', PUBLIC_API_URL: '', CLIENT_URL: '',
        ALLOWED_ORIGINS: '', COOKIE_DOMAIN: '', JWT_SECRET: '', JWT_REFRESH_SECRET: '', OTP_PEPPER: '', CRON_SIGNING_SECRET: '' },
      encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(`${result.stderr}${result.stdout}`).toMatch(/Missing or insecure production configuration/)
  })
})
