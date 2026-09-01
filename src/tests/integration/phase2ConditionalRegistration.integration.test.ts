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
let runtimeConfig: any
let readCapturedOtpForTest: (identity: string, purpose: string) => string | null

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

const getWithSession = async (path: string, responseWithCookies: Response) => {
  const cookie = authCookieHeader(responseWithCookies)
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: { origin: 'http://localhost:3000', cookie },
  })
  return { response, body: await response.json() as any }
}

suite('conditional registration verification and phase 3 routing protection', () => {
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
    runtimeConfig = (await import('../../config')).default
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
    expect(authCookieHeader(result.response)).toBe('')
    const verificationCode = readCapturedOtpForTest(email, 'account_verification')
    expect(verificationCode).toMatch(/^\d{6}$/)
    expect(await AuditEvent.exists({ organizationId: user.organizationId, action: 'identity.verification_required', entityId: user._id.toString() })).toBeTruthy()

    const verified = await request('/api/v1/auth/verify', { email, verificationCode })
    expect(verified.response.status).toBe(200)
    expect(verified.body?.data?.user).toMatchObject({ isVerified: true, status: 'active' })
    expect(authCookieHeader(verified.response)).toContain('accessToken=')
    expect(authCookieHeader(verified.response)).toContain('refreshToken=')
    expect(await User.findOne({ email }).lean()).toMatchObject({ status: 'active', isVerified: true })
    expect(await AuthSession.countDocuments({ userId: user._id, revokedAt: null })).toBe(1)
    expect(await OtpChallenge.countDocuments({ userId: user._id, purpose: 'account_verification', consumedAt: { $ne: null } })).toBe(1)

    const onboardingBootstrap = await getWithSession('/api/v1/organization', verified.response)
    expect(onboardingBootstrap.response.status).toBe(200)
    expect(onboardingBootstrap.body?.data?.onboarding).toMatchObject({ status: 'not_started', currentStep: 1 })
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

    const onboardingBootstrap = await getWithSession('/api/v1/organization', result.response)
    expect(onboardingBootstrap.response.status).toBe(200)
    expect(onboardingBootstrap.body?.data?.onboarding).toMatchObject({ status: 'not_started', currentStep: 1 })
  })

  it('does not disable password-reset OTP when registration verification is disabled', async () => {
    const email = 'auto-verified@example.test'
    const result = await request('/api/v1/auth/password-reset/request', { email })

    expect(result.response.status).toBe(202)
    expect(await OtpChallenge.countDocuments({ email, purpose: 'password_reset', consumedAt: null })).toBe(1)
    expect(readCapturedOtpForTest(email, 'password_reset')).toMatch(/^\d{6}$/)
  })


  it('keeps password-reset requests enumeration-safe for missing, unverified and inactive accounts', async () => {
    await OtpChallenge.deleteMany({ purpose: 'password_reset' })

    const missing = await request('/api/v1/auth/password-reset/request', { email: 'missing@example.test' })
    expect(missing.response.status).toBe(202)
    expect(await OtpChallenge.countDocuments({ purpose: 'password_reset' })).toBe(0)

    const verificationUser = await User.findOne({ email: 'otp-required@example.test' })
    await User.updateOne({ _id: verificationUser._id }, { $set: { isVerified: false, status: 'active' } })
    const unverified = await request('/api/v1/auth/password-reset/request', { email: 'otp-required@example.test' })
    expect(unverified.response.status).toBe(202)
    expect(await OtpChallenge.countDocuments({ email: 'otp-required@example.test', purpose: 'password_reset' })).toBe(0)
    await User.updateOne({ _id: verificationUser._id }, { $set: { isVerified: true, status: 'active' } })

    const activeUser = await User.findOne({ email: 'auto-verified@example.test' })
    await User.updateOne({ _id: activeUser._id }, { $set: { status: 'blocked' } })
    const inactive = await request('/api/v1/auth/password-reset/request', { email: 'auto-verified@example.test' })
    expect(inactive.response.status).toBe(202)
    expect(await OtpChallenge.countDocuments({ email: 'auto-verified@example.test', purpose: 'password_reset' })).toBe(0)
    await User.updateOne({ _id: activeUser._id }, { $set: { status: 'active' } })
  })

  it('rolls back the reset challenge when real email delivery is unavailable without exposing account existence', async () => {
    const email = 'auto-verified@example.test'
    await OtpChallenge.deleteMany({ email, purpose: 'password_reset' })
    const original = {
      development_mode: runtimeConfig.email.development_mode,
      host: runtimeConfig.email.host,
      user: runtimeConfig.email.user,
      password: runtimeConfig.email.password,
      from: runtimeConfig.email.from,
    }
    Object.assign(runtimeConfig.email, { development_mode: false, host: '', user: '', password: '', from: '' })
    try {
      const result = await request('/api/v1/auth/password-reset/request', { email })
      expect(result.response.status).toBe(202)
      expect(result.body?.message).toBe('If the account exists, a reset code was sent.')
      expect(await OtpChallenge.countDocuments({ email, purpose: 'password_reset', consumedAt: null })).toBe(0)
    } finally {
      Object.assign(runtimeConfig.email, original)
    }
  })

  it('invalidates older reset OTPs, rejects expired codes, resets the password, and revokes existing sessions', async () => {
    const email = 'auto-verified@example.test'
    await OtpChallenge.deleteMany({ email, purpose: 'password_reset' })

    await request('/api/v1/auth/password-reset/request', { email })
    const first = await OtpChallenge.findOne({ email, purpose: 'password_reset' }).sort({ createdAt: -1 }).lean()
    expect(first?.consumedAt).toBeNull()

    await request('/api/v1/auth/password-reset/request', { email })
    const refreshedFirst = await OtpChallenge.findById(first._id).lean()
    expect(refreshedFirst?.consumedAt).toBeInstanceOf(Date)
    expect(await OtpChallenge.countDocuments({ email, purpose: 'password_reset', consumedAt: null })).toBe(1)

    const expiredCode = readCapturedOtpForTest(email, 'password_reset')
    expect(expiredCode).toMatch(/^\d{6}$/)
    await OtpChallenge.updateOne({ email, purpose: 'password_reset', consumedAt: null }, { $set: { expiresAt: new Date(Date.now() - 1_000) } })
    const expired = await request('/api/v1/auth/password-reset/verify', { email, verificationCode: expiredCode })
    expect(expired.response.status).toBe(401)

    await request('/api/v1/auth/password-reset/request', { email })
    const validCode = readCapturedOtpForTest(email, 'password_reset')
    expect(validCode).toMatch(/^\d{6}$/)
    const verified = await request('/api/v1/auth/password-reset/verify', { email, verificationCode: validCode })
    expect(verified.response.status).toBe(200)
    expect(verified.body?.data?.resetToken).toEqual(expect.any(String))

    const activeUser = await User.findOne({ email }).lean()
    expect(await AuthSession.countDocuments({ userId: activeUser._id, revokedAt: null })).toBeGreaterThan(0)

    const completed = await request('/api/v1/auth/password-reset/complete', {
      resetToken: verified.body.data.resetToken,
      newPassword: 'BetterPass123!',
    })
    expect(completed.response.status).toBe(200)
    expect(await AuthSession.countDocuments({ userId: activeUser._id, revokedAt: null })).toBe(0)

    const oldLogin = await request('/api/v1/auth/login', { email, password: 'Production123!' })
    expect(oldLogin.response.status).toBe(401)
    const newLogin = await request('/api/v1/auth/login', { email, password: 'BetterPass123!' })
    expect(newLogin.response.status).toBe(200)
    expect(authCookieHeader(newLogin.response)).toContain('accessToken=')
  })
})
