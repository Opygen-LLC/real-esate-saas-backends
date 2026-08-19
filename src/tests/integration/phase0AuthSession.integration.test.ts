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
let sessionId = ''

const request = async (cookie = '') => {
  const response = await fetch(`${baseUrl}/api/v1/auth/session`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(cookie ? { cookie } : {}),
    },
  })
  const body = await response.json() as any
  return { response, body }
}

suite('phase 0 authenticated session contract', () => {
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

    const organizationId = 'org_phase0_session'
    await Organization.create({
      organizationId,
      agencyName: 'Phase Zero Session Realty',
      email: 'session@example.test',
      phone: '+8801712345678',
      sub_domain: 'phase0-session',
      subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 2 },
    })
    const user = await User.create({
      name: 'Session Owner',
      email: 'session-owner@example.test',
      phoneNumber: '+8801712345678',
      organizationId,
      userRole: 'agency_owner',
      status: 'active',
      isVerified: true,
    })

    const id = new mongoose.Types.ObjectId()
    sessionId = id.toString()
    const familyId = 'phase0-family'
    accessToken = jwtHelpers.createToken({
      _id: user._id.toString(),
      phoneNumber: user.phoneNumber,
      email: user.email,
      userRole: user.userRole,
      organizationId,
    }, config.jwt.secret, config.jwt.expires_in)
    refreshToken = jwtHelpers.createToken({
      _id: user._id.toString(),
      sessionId,
      familyId,
      organizationId,
    }, config.jwt.refresh_secret, config.jwt.refresh_expires_in)

    await AuthSession.create({
      _id: id,
      userId: user._id,
      organizationId,
      familyId,
      refreshTokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdIp: '127.0.0.1',
      lastUsedIp: '127.0.0.2',
      userAgent: 'Phase0 Regression Browser',
    })

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

  it('returns only the safe current-session summary when a valid refresh cookie is present', async () => {
    const result = await request(`refreshToken=${encodeURIComponent(refreshToken)}`)
    expect(result.response.status).toBe(200)
    expect(result.body?.data?.authenticated).toBe(true)
    expect(result.body?.data?.session).toMatchObject({
      id: sessionId,
      current: true,
      userAgent: 'Phase0 Regression Browser',
      createdIp: '127.0.0.1',
      lastUsedIp: '127.0.0.2',
    })
    expect(result.body?.data?.session).not.toHaveProperty('refreshTokenHash')
    expect(result.body?.data?.session).not.toHaveProperty('tokenHash')
    expect(result.body?.data?.session).not.toHaveProperty('familyId')
  })

  it('still supports bearer-only authenticated clients without inventing a current browser session', async () => {
    const result = await request()
    expect(result.response.status).toBe(200)
    expect(result.body?.data?.authenticated).toBe(true)
    expect(result.body?.data?.session).toBeNull()
  })
})
