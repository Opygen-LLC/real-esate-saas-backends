import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(path, 'utf8')

describe('registration continuation security contracts', () => {
  it('stores only a hashed short-lived continuation token on account-verification challenges', () => {
    const service = read('src/app/module/auth/auth.services.ts')
    const model = read('src/app/module/auth/otpChallenge.model.ts')

    expect(service).toMatch(/REGISTRATION_CONTINUATION_TTL_MS = 30 \* 60 \* 1000/)
    expect(service).toMatch(/registrationContinuationToken = verificationRequired \? randomToken\(32\) : null/)
    expect(service).toMatch(/continuationTokenHash: sha256\(registrationContinuationToken\)/)
    expect(model).toMatch(/continuationTokenHash: \{ type: String, select: false \}/)
    expect(model).toMatch(/continuationConsumedAt/)
    expect(model).toMatch(/manualApprovedAt/)
  })

  it('uses token-based status and completion endpoints rather than email-only authentication', () => {
    const route = read('src/app/module/auth/auth.route.ts')
    const validation = read('src/app/module/auth/auth.validation.ts')
    const service = read('src/app/module/auth/auth.services.ts')

    expect(route).toMatch(/\/registration-status'.*registrationStatusRateLimiter/s)
    expect(route).toMatch(/\/registration\/complete'.*authRateLimiter/s)
    expect(validation).toMatch(/registrationContinuationToken: z\.string\(\)\.trim\(\)\.min\(32\)\.max\(256\)/)
    expect(service).toMatch(/continuationTokenHash: sha256\(token\)/)
    expect(service).not.toMatch(/getRegistrationStatus = async \([^)]*email/i)
  })

  it('makes completion one-time and creates the normal authenticated session only after the user is active and verified', () => {
    const service = read('src/app/module/auth/auth.services.ts')

    expect(service).toMatch(/User\.findOne\(\{ _id: challenge\.userId, isVerified: true, status: 'active' \}\)/)
    expect(service).toMatch(/continuationConsumedAt: null/)
    expect(service).toMatch(/\$set: \{ continuationConsumedAt: consumedAt \}/)
    expect(service).toMatch(/return await createSession\(user, meta\)/)
  })

  it('keeps password-reset OTP isolated and marks manual approval on registration challenges only', () => {
    const userService = read('src/app/module/user/user.service.ts')
    const authService = read('src/app/module/auth/auth.services.ts')

    expect(userService).toMatch(/purpose: 'account_verification'/)
    expect(userService).toMatch(/manualApprovedAt: verifiedAt/)
    expect(authService).toMatch(/createOtpChallenge\(email, 'password_reset'/)
    expect(authService).toMatch(/consumeOtp\(email, code, 'password_reset'\)/)
  })

  it('ships explicit production indexing because production autoIndex is disabled', () => {
    const model = read('src/app/module/auth/otpChallenge.model.ts')
    const migration = read('src/app/db/migrateRegistrationContinuationToken.ts')
    const packageJson = read('package.json')

    expect(model).toMatch(/otp_challenge_continuation_token_unique/)
    expect(migration).toMatch(/createIndex/)
    expect(migration).toMatch(/continuationTokenHash: 1/)
    expect(migration).toMatch(/unique: true, sparse: true/)
    expect(packageJson).toMatch(/migrate:registration-continuation/)
  })
})
