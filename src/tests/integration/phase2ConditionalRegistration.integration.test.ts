import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip

let server: Server
let baseUrl = ''
let mongoose: typeof import('mongoose')
let PlatformSettings: any
let User: any
let AccountCredential: any
let OtpChallenge: any
let AuthSession: any
let AuditEvent: any
let readCapturedOtpForTest: (identity: string, purpose: string) => string | null

const request = async (path: string, body: Record<string, unknown>) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  })
  return { response, body: await response.json() as any }
}

suite('phase 2 conditional registration verification', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'false'
    process.env.WORKER_ENABLED = 'false'
    process.env.EMAIL_DEV_MODE = 'true'
    process.env.CLIENT_URL = 'http://localhost:3000'
    process.env.PUBLIC_API_URL = 'http://127.0.0.1:5000'
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

    mongoose = await import('mongoose')
    await mongoose.connect(requiredDb!, { autoIndex: true, serverSelectionTimeoutMS: 5000 })
    await mongoose.connection.dropDatabase()
    ;({ PlatformSettings } = await import('../../app/module/platformSettings/platformSettings.model'))
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ AccountCredential } = await import('../../app/module/accountCredential/accountCredential.model'))
    ;({ OtpChallenge } = await import('../../app/module/auth/otpChallenge.model'))
    ;({ AuthSession } = await import('../../app/module/auth/authSession.model'))
    ;({ AuditEvent } = await import('../../app/module/audit/audit.model'))
    ;({ readCapturedOtpForTest } = await import('../../testSupport/otpCapture'))

    await PlatformSettings.create({ key: 'platform', authentication: { requireEmailOtpVerification: true } })

    const app = (await import('../../app')).default
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind integration server')
        baseUrl = `http://127.0.0.1:${address.port}`
        resolve()
      })
    })
  }, 20_000)

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('keeps the existing OTP registration flow when verification is enabled', async () => {
    await PlatformSettings.updateOne({ key: 'platform' }, { $set: { 'authentication.requireEmailOtpVerification': true } })
    const email = 'otp-required@example.test'

    const result = await request('/api/v1/auth/register-agency', {
      name: 'OTP Required Owner',
      email,
      phoneNumber: '01711111111',
      password: 'Production123!',
      agencyName: 'OTP Required Realty',
      agencyType: 'residential',
    })

    expect(result.response.status).toBe(201)
    expect(result.body?.data).toMatchObject({ verificationRequired: true, verificationChannel: 'email' })
    const user = await User.findOne({ email }).lean()
    expect(user).toMatchObject({ status: 'pending', isVerified: false })
    expect(await OtpChallenge.countDocuments({ userId: user._id, purpose: 'account_verification' })).toBe(1)
    expect(await AuthSession.countDocuments({ userId: user._id })).toBe(0)
    expect(readCapturedOtpForTest(email, 'account_verification')).toMatch(/^\d{6}$/)
    expect(await AuditEvent.exists({ organizationId: user.organizationId, action: 'identity.verification_required', entityId: user._id.toString() })).toBeTruthy()
  })

  it('auto-verifies and authenticates registration without generating OTP when verification is disabled', async () => {
    await PlatformSettings.updateOne({ key: 'platform' }, { $set: { 'authentication.requireEmailOtpVerification': false } })
    const email = 'auto-verified@example.test'

    const result = await request('/api/v1/auth/register-agency', {
      name: 'Auto Verified Owner',
      email,
      phoneNumber: '01722222222',
      password: 'Production123!',
      agencyName: 'Auto Verified Realty',
      agencyType: 'residential',
    })

    expect(result.response.status).toBe(201)
    expect(result.body?.data).toMatchObject({
      verificationRequired: false,
      isVerified: true,
      onboarding: { status: 'not_started', currentStep: 1 },
    })
    expect(result.body?.data).not.toHaveProperty('accessToken')
    expect(result.body?.data).not.toHaveProperty('refreshToken')

    const user = await User.findOne({ email }).lean()
    expect(user).toMatchObject({ status: 'active', isVerified: true })
    const credential = await AccountCredential.findOne({ userId: user._id }).lean()
    expect(credential?.emailVerifiedAt).toBeInstanceOf(Date)
    expect(await OtpChallenge.countDocuments({ userId: user._id, purpose: 'account_verification' })).toBe(0)
    expect(await AuthSession.countDocuments({ userId: user._id, revokedAt: null })).toBe(1)
    expect(readCapturedOtpForTest(email, 'account_verification')).toBeNull()
    expect(await AuditEvent.exists({
      organizationId: user.organizationId,
      action: 'identity.auto_verified',
      entityId: user._id.toString(),
      'metadata.source': 'platform_setting',
      'metadata.verificationMethod': 'automatic',
    })).toBeTruthy()

    const setCookie = result.response.headers.get('set-cookie') || ''
    expect(setCookie).toMatch(/accessToken=/)
    expect(setCookie).toMatch(/refreshToken=/)
  })

  it('does not disable password-reset OTP when registration verification is disabled', async () => {
    const email = 'auto-verified@example.test'
    const result = await request('/api/v1/auth/password-reset/request', { email })

    expect(result.response.status).toBe(202)
    expect(await OtpChallenge.countDocuments({ email, purpose: 'password_reset', consumedAt: null })).toBe(1)
    expect(readCapturedOtpForTest(email, 'password_reset')).toMatch(/^\d{6}$/)
  })
})
