import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(path, 'utf8')

describe('phase 3 conditional registration security contracts', () => {
  it('keeps the platform setting decision inside server-side agency registration', () => {
    const service = read('src/app/module/auth/auth.services.ts')
    const controller = read('src/app/module/auth/auth.controller.ts')

    expect(service).toMatch(/requireEmailOtpVerificationForRegistration/)
    expect(service).toMatch(/const verificationRequired = await requireEmailOtpVerificationForRegistration\(\)/)
    expect(service).toMatch(/status: verificationRequired \? 'pending' : 'active'/)
    expect(service).toMatch(/isVerified: !verificationRequired/)
    expect(controller).toMatch(/if \(!result\.verificationRequired\)/)
    expect(controller).toMatch(/setAuthCookies\(res, result\)/)
  })

  it('keeps login verification enforcement server-side', () => {
    const service = read('src/app/module/auth/auth.services.ts')

    expect(service).toMatch(/!user\.isVerified \|\| user\.status !== 'active'/)
    expect(service).toMatch(/EMAIL_VERIFICATION_REQUIRED/)
  })

  it('does not apply the registration setting to password reset OTP', () => {
    const service = read('src/app/module/auth/auth.services.ts')

    expect(service).toMatch(/createOtpChallenge\(email, 'password_reset'/)
    expect(service).toMatch(/consumeOtp\(email, code, 'password_reset'\)/)
    expect(service).toMatch(/consumeOtp\(email, code, 'account_verification'\)/)
  })
})
