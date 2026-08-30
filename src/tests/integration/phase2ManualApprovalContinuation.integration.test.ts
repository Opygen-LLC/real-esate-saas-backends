import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip

let server: Server
let baseUrl = ''
let mongoose: typeof import('mongoose')
let PlatformSettings: any
let User: any
let OtpChallenge: any
let AuthSession: any
let UserService: any
let readCapturedOtpForTest: (identity: string, purpose: string) => string | null
let sha256: (value: string) => string

const request = async (path: string, body: Record<string, unknown>) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  })
  return { response, body: await response.json() as any }
}

const authCookieHeader = (response: Response): string => {
  const setCookie = response.headers.get('set-cookie') || ''
  return ['accessToken', 'refreshToken']
    .map((name) => {
      const match = setCookie.match(new RegExp(`${name}=([^;, ]+)`))
      return match ? `${name}=${match[1]}` : ''
    })
    .filter(Boolean)
    .join('; ')
}

const registerPending = async (sequence: number) => {
  const email = `manual-approval-${sequence}@example.test`
  const response = await request('/api/v1/auth/register-agency', {
    name: `Manual Approval Owner ${sequence}`,
    email,
    phoneNumber: `017${String(30000000 + sequence).padStart(8, '0')}`,
    password: 'Production123!',
    agencyName: `Manual Approval Realty ${sequence}`,
    agencyType: 'residential',
  })
  expect(response.response.status).toBe(201)
  expect(response.body?.data?.verificationRequired).toBe(true)
  expect(response.body?.data?.registrationContinuationToken).toEqual(expect.any(String))
  const user = await User.findOne({ email }).lean()
  expect(user).toMatchObject({ status: 'pending', isVerified: false })
  return {
    email,
    user,
    continuationToken: response.body.data.registrationContinuationToken as string,
    verificationCode: readCapturedOtpForTest(email, 'account_verification') as string,
  }
}

const manuallyVerify = async (userId: string) => UserService.verifyUserSuperAdmin(userId, {
  actorId: new mongoose.Types.ObjectId().toString(),
  reason: 'Customer identity confirmed by platform support.',
  requestId: `manual-verification-${userId}`,
  ip: '127.0.0.1',
})

suite('manual approval registration continuation flow', () => {
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
    ;({ OtpChallenge } = await import('../../app/module/auth/otpChallenge.model'))
    ;({ AuthSession } = await import('../../app/module/auth/authSession.model'))
    ;({ UserService } = await import('../../app/module/user/user.service'))
    ;({ readCapturedOtpForTest } = await import('../../testSupport/otpCapture'))
    ;({ sha256 } = await import('../../app/helpers/crypto'))

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

  it('keeps normal OTP verification fully functional and stores only the continuation-token hash', async () => {
    const registration = await registerPending(1)
    const challenge = await OtpChallenge.findOne({ email: registration.email, purpose: 'account_verification' })
      .select('+continuationTokenHash')
      .lean()

    expect(challenge?.continuationTokenHash).toBe(sha256(registration.continuationToken))
    expect(challenge?.continuationTokenHash).not.toBe(registration.continuationToken)

    const status = await request('/api/v1/auth/registration-status', {
      registrationContinuationToken: registration.continuationToken,
    })
    expect(status.response.status).toBe(200)
    expect(status.body?.data).toEqual({ verified: false, status: 'pending' })

    const verified = await request('/api/v1/auth/verify', {
      email: registration.email,
      verificationCode: registration.verificationCode,
    })
    expect(verified.response.status).toBe(200)
    expect(authCookieHeader(verified.response)).toContain('accessToken=')
    expect(await User.findById(registration.user._id).lean()).toMatchObject({ status: 'active', isVerified: true })
    expect(await AuthSession.countDocuments({ userId: registration.user._id, revokedAt: null })).toBe(1)

    const replayStatus = await request('/api/v1/auth/registration-status', {
      registrationContinuationToken: registration.continuationToken,
    })
    expect(replayStatus.response.status).toBe(409)
    expect(replayStatus.body?.code).toBe('REGISTRATION_CONTINUATION_CONSUMED')
  })

  it('lets a waiting registration detect Super Admin approval and securely create its session', async () => {
    const registration = await registerPending(2)
    const manual = await manuallyVerify(registration.user._id.toString())
    expect(manual).toMatchObject({ alreadyVerified: false, verificationMethod: 'manual_admin_approval' })

    const status = await request('/api/v1/auth/registration-status', {
      registrationContinuationToken: registration.continuationToken,
    })
    expect(status.response.status).toBe(200)
    expect(status.body?.data).toEqual({ verified: true, status: 'active', verificationMethod: 'admin' })

    const completed = await request('/api/v1/auth/registration/complete', {
      registrationContinuationToken: registration.continuationToken,
    })
    expect(completed.response.status).toBe(200)
    expect(completed.body?.data).toMatchObject({ isVerified: true, onboarding: { status: 'not_started', currentStep: 1 } })
    expect(authCookieHeader(completed.response)).toContain('accessToken=')
    expect(authCookieHeader(completed.response)).toContain('refreshToken=')
    expect(await AuthSession.countDocuments({ userId: registration.user._id, revokedAt: null })).toBe(1)
  })

  it('rejects the old registration OTP after Super Admin approval without creating a second verification transition', async () => {
    const registration = await registerPending(3)
    await manuallyVerify(registration.user._id.toString())

    const otpAttempt = await request('/api/v1/auth/verify', {
      email: registration.email,
      verificationCode: registration.verificationCode,
    })
    expect(otpAttempt.response.status).toBe(401)
    expect(await User.findById(registration.user._id).lean()).toMatchObject({ status: 'active', isVerified: true })
    expect(await AuthSession.countDocuments({ userId: registration.user._id, revokedAt: null })).toBe(0)
  })

  it('keeps manual verification idempotent when OTP verification wins first', async () => {
    const registration = await registerPending(4)
    const verified = await request('/api/v1/auth/verify', {
      email: registration.email,
      verificationCode: registration.verificationCode,
    })
    expect(verified.response.status).toBe(200)

    const manual = await manuallyVerify(registration.user._id.toString())
    expect(manual).toMatchObject({ alreadyVerified: true, verificationMethod: 'existing' })
    expect(await User.findById(registration.user._id).lean()).toMatchObject({ status: 'active', isVerified: true })
    expect(await AuthSession.countDocuments({ userId: registration.user._id, revokedAt: null })).toBe(1)
  })

  it('consumes only account-verification OTPs and leaves password-reset challenges independent', async () => {
    const registration = await registerPending(5)
    await OtpChallenge.create({
      email: registration.email,
      channel: 'email',
      userId: registration.user._id,
      organizationId: registration.user.organizationId,
      purpose: 'password_reset',
      codeHash: 'independent-password-reset-hash',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })

    await manuallyVerify(registration.user._id.toString())

    expect(await OtpChallenge.countDocuments({ userId: registration.user._id, purpose: 'account_verification', consumedAt: { $ne: null } })).toBeGreaterThan(0)
    expect(await OtpChallenge.countDocuments({ userId: registration.user._id, purpose: 'password_reset', consumedAt: null })).toBe(1)
  })

  it('rejects fake and expired continuation tokens without creating a session', async () => {
    const fakeStatus = await request('/api/v1/auth/registration-status', {
      registrationContinuationToken: 'x'.repeat(43),
    })
    expect(fakeStatus.response.status).toBe(400)
    expect(fakeStatus.body?.code).toBe('REGISTRATION_CONTINUATION_INVALID')

    const fakeComplete = await request('/api/v1/auth/registration/complete', {
      registrationContinuationToken: 'y'.repeat(43),
    })
    expect(fakeComplete.response.status).toBe(400)
    expect(fakeComplete.body?.code).toBe('REGISTRATION_CONTINUATION_INVALID')

    const registration = await registerPending(6)
    await OtpChallenge.updateOne(
      { userId: registration.user._id, continuationTokenHash: sha256(registration.continuationToken) },
      { $set: { continuationExpiresAt: new Date(Date.now() - 1000) } },
    )

    const expiredStatus = await request('/api/v1/auth/registration-status', {
      registrationContinuationToken: registration.continuationToken,
    })
    expect(expiredStatus.response.status).toBe(410)
    expect(expiredStatus.body?.code).toBe('REGISTRATION_CONTINUATION_EXPIRED')
    expect(await AuthSession.countDocuments({ userId: registration.user._id })).toBe(0)
  })

  it('allows a continuation token to complete registration exactly once', async () => {
    const registration = await registerPending(7)
    await manuallyVerify(registration.user._id.toString())

    const first = await request('/api/v1/auth/registration/complete', {
      registrationContinuationToken: registration.continuationToken,
    })
    expect(first.response.status).toBe(200)
    expect(await AuthSession.countDocuments({ userId: registration.user._id, revokedAt: null })).toBe(1)

    const second = await request('/api/v1/auth/registration/complete', {
      registrationContinuationToken: registration.continuationToken,
    })
    expect(second.response.status).toBe(409)
    expect(second.body?.code).toBe('REGISTRATION_CONTINUATION_CONSUMED')
    expect(await AuthSession.countDocuments({ userId: registration.user._id, revokedAt: null })).toBe(1)
  })

  it('does not let manual verification reactivate a blocked user', async () => {
    const registration = await registerPending(8)
    await User.updateOne(
      { _id: registration.user._id },
      { $set: { status: 'blocked', accessRestriction: { source: 'platform_admin', reason: 'Security hold', blockedAt: new Date(), blockedBy: 'test', previousStatus: 'pending' } } },
    )

    await expect(manuallyVerify(registration.user._id.toString())).rejects.toThrow(/pending, unverified/i)
    expect(await User.findById(registration.user._id).lean()).toMatchObject({ status: 'blocked', isVerified: false })
  })
})
