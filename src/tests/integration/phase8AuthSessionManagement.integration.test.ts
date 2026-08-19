import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip
let server: Server
let baseUrl = ''
let mongoose: typeof import('mongoose')
let User: any
let Organization: any
let AuthSession: any
let jwtHelpers: any
let sha256: (value: string) => string
let config: any
let accessToken = ''
let refreshToken = ''
let currentSessionId = ''
let otherSessionId = ''
let foreignSessionId = ''
let userId = ''
const organizationId = 'org_phase8_sessions'
const csrfToken = 'phase8-session-csrf-token'

const authHeaders = (withCsrf = false) => ({
  authorization: `Bearer ${accessToken}`,
  cookie: `${config.security.refresh_cookie_name}=${encodeURIComponent(refreshToken)}; ${config.security.csrf_cookie_name}=${csrfToken}`,
  ...(withCsrf ? { 'x-csrf-token': csrfToken } : {}),
})

const json = async (response: Response) => ({ response, body: await response.json() as any })

suite('phase 8 auth session management', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'false'
    process.env.WORKER_ENABLED = 'false'
    process.env.CLIENT_URL = 'http://localhost:3000'
    process.env.PUBLIC_API_URL = 'http://127.0.0.1:5000'
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

    mongoose = await import('mongoose')
    await mongoose.connect(requiredDb!, { autoIndex: true, serverSelectionTimeoutMS: 5000 })
    await mongoose.connection.dropDatabase()
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ AuthSession } = await import('../../app/module/auth/authSession.model'))
    ;({ jwtHelpers } = await import('../../app/helpers/jwtHelpers'))
    ;({ sha256 } = await import('../../app/helpers/crypto'))
    config = (await import('../../config')).default

    await Organization.create({
      organizationId,
      agencyName: 'Phase Eight Session Realty',
      email: 'phase8@example.test',
      phone: '+8801712345678',
      sub_domain: 'phase8-session',
      subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 2 },
    })
    const user = await User.create({
      name: 'Session Owner',
      email: 'phase8-owner@example.test',
      phoneNumber: '+8801712345678',
      organizationId,
      userRole: 'agency_owner',
      status: 'active',
      isVerified: true,
    })
    userId = user._id.toString()
    const foreignUser = await User.create({
      name: 'Foreign Agent',
      email: 'phase8-agent@example.test',
      phoneNumber: '+8801812345678',
      organizationId,
      userRole: 'agent',
      status: 'active',
      isVerified: true,
    })

    const currentId = new mongoose.Types.ObjectId()
    currentSessionId = currentId.toString()
    otherSessionId = new mongoose.Types.ObjectId().toString()
    foreignSessionId = new mongoose.Types.ObjectId().toString()
    const familyId = 'phase8-current-family'
    accessToken = jwtHelpers.createToken({
      _id: userId,
      phoneNumber: user.phoneNumber,
      email: user.email,
      userRole: user.userRole,
      organizationId,
    }, config.jwt.secret, config.jwt.expires_in)
    refreshToken = jwtHelpers.createToken({
      _id: userId,
      sessionId: currentSessionId,
      familyId,
      organizationId,
    }, config.jwt.refresh_secret, config.jwt.refresh_expires_in)

    await AuthSession.insertMany([
      {
        _id: currentId,
        userId: user._id,
        organizationId,
        familyId,
        refreshTokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + 86_400_000),
        createdIp: '127.0.0.1',
        lastUsedIp: '127.0.0.1',
        userAgent: 'Mozilla/5.0 Chrome/150.0.0.0 Windows NT 10.0',
      },
      {
        _id: otherSessionId,
        userId: user._id,
        organizationId,
        familyId: 'phase8-other-family',
        refreshTokenHash: 'other-hash',
        expiresAt: new Date(Date.now() + 86_400_000),
        createdIp: '10.0.0.2',
        lastUsedIp: '10.0.0.3',
        userAgent: 'Mozilla/5.0 Firefox/142.0 Linux',
      },
      {
        _id: foreignSessionId,
        userId: foreignUser._id,
        organizationId,
        familyId: 'phase8-foreign-family',
        refreshTokenHash: 'foreign-hash',
        expiresAt: new Date(Date.now() + 86_400_000),
        userAgent: 'Foreign browser',
      },
    ])

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

  it('lists only the authenticated user active sessions and never exposes token material', async () => {
    const result = await json(await fetch(`${baseUrl}/api/v1/auth/sessions`, { headers: authHeaders() }))
    expect(result.response.status).toBe(200)
    expect(result.body.data).toHaveLength(2)
    expect(result.body.data.map((session: any) => session.id)).toEqual(expect.arrayContaining([currentSessionId, otherSessionId]))
    expect(result.body.data.some((session: any) => session.id === foreignSessionId)).toBe(false)
    const current = result.body.data.find((session: any) => session.id === currentSessionId)
    expect(current?.current).toBe(true)
    for (const session of result.body.data) {
      expect(session).not.toHaveProperty('refreshTokenHash')
      expect(session).not.toHaveProperty('tokenHash')
      expect(session).not.toHaveProperty('familyId')
      expect(session).not.toHaveProperty('userId')
      expect(session).not.toHaveProperty('organizationId')
    }
  })

  it('rejects revoking the current browser session on the server', async () => {
    const result = await json(await fetch(`${baseUrl}/api/v1/auth/sessions/${currentSessionId}`, {
      method: 'DELETE',
      headers: authHeaders(true),
    }))
    expect(result.response.status).toBe(400)
    expect(result.body.code).toBe('CURRENT_SESSION_CANNOT_BE_REVOKED')
    expect(await AuthSession.exists({ _id: currentSessionId, revokedAt: null })).toBeTruthy()
  })

  it('cannot revoke another user session by guessing its id', async () => {
    const result = await json(await fetch(`${baseUrl}/api/v1/auth/sessions/${foreignSessionId}`, {
      method: 'DELETE',
      headers: authHeaders(true),
    }))
    expect(result.response.status).toBe(404)
    expect(await AuthSession.exists({ _id: foreignSessionId, revokedAt: null })).toBeTruthy()
  })

  it('revokes a selected own session while keeping the current session active', async () => {
    const result = await json(await fetch(`${baseUrl}/api/v1/auth/sessions/${otherSessionId}`, {
      method: 'DELETE',
      headers: authHeaders(true),
    }))
    expect(result.response.status).toBe(200)
    expect(await AuthSession.exists({ _id: otherSessionId, revokedAt: null })).toBeFalsy()
    expect(await AuthSession.exists({ _id: currentSessionId, revokedAt: null })).toBeTruthy()
  })

  it('revoke-others preserves current session and revokes every other active session for this user only', async () => {
    const extraSessionId = new mongoose.Types.ObjectId()
    await AuthSession.create({
      _id: extraSessionId,
      userId,
      organizationId,
      familyId: 'phase8-extra-family',
      refreshTokenHash: 'extra-hash',
      expiresAt: new Date(Date.now() + 86_400_000),
      userAgent: 'Extra browser',
    })

    const result = await json(await fetch(`${baseUrl}/api/v1/auth/sessions/revoke-others`, {
      method: 'POST',
      headers: authHeaders(true),
    }))
    expect(result.response.status).toBe(200)
    expect(result.body.data.revokedCount).toBe(1)
    expect(await AuthSession.exists({ _id: currentSessionId, revokedAt: null })).toBeTruthy()
    expect(await AuthSession.exists({ _id: extraSessionId, revokedAt: null })).toBeFalsy()
    expect(await AuthSession.exists({ _id: foreignSessionId, revokedAt: null })).toBeTruthy()
  })
})
