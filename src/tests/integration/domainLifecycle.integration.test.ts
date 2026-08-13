import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('dns/promises', () => ({
  default: {
    resolveTxt: vi.fn(async () => [['realestate-saas=phase7-domain-token']]),
    resolve4: vi.fn(async () => ['76.76.21.21']),
    resolveCname: vi.fn(async () => ['cname.realestate-saas.com']),
  },
}))

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip
let server: Server
let baseUrl = ''
let mongoose: typeof import('mongoose')
let User: any
let Organization: any
let DomainRecord: any
let jwtHelpers: any
let config: any

const request = async (path: string, headers: Record<string, string> = {}, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...headers, ...(init.headers || {}) },
  })
  const text = await response.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { response, body }
}

suite('custom-domain lifecycle integration', () => {
  const organizationId = 'org_phase7_domain'
  const domain = 'phase7-domain.example'
  let auth: Record<string, string>

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'false'
    process.env.WORKER_ENABLED = 'false'
    process.env.SMS_DEV_MODE = 'true'
    process.env.CLIENT_URL = 'http://localhost:3000'
    process.env.PUBLIC_API_URL = 'http://127.0.0.1:5000'
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000'
    process.env.DOMAIN_TLS_PROVIDER_URL = ''

    mongoose = await import('mongoose')
    await mongoose.connect(requiredDb!, { autoIndex: true, serverSelectionTimeoutMS: 5000 })
    await mongoose.connection.dropDatabase()
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ DomainRecord } = await import('../../app/module/domain/domain.model'))
    ;({ jwtHelpers } = await import('../../app/helpers/jwtHelpers'))
    config = (await import('../../config')).default

    await Organization.create({
      organizationId,
      agencyName: 'Phase Seven Domain Realty',
      email: 'domain-owner@example.com',
      phone: '+8801711111111',
      sub_domain: 'phase7-domain',
      subscription: { plan: 'professional', status: 'active', maxProperties: 100, maxAgents: 10 },
    })
    const user = await User.create({
      name: 'Domain Owner',
      email: 'domain-owner@example.com',
      phoneNumber: '+8801711111111',
      password: 'Production123!',
      organizationId,
      userRole: 'agency_owner',
      status: 'active',
      isVerified: true,
    })
    const token = jwtHelpers.createToken({
      _id: user._id.toString(),
      phoneNumber: user.phoneNumber,
      email: user.email,
      userRole: user.userRole,
      organizationId,
    }, config.jwt.secret, config.jwt.expires_in)
    auth = { authorization: `Bearer ${token}` }

    await DomainRecord.create({
      organizationId,
      domain,
      ownershipToken: 'phase7-domain-token',
      status: 'pending',
      tlsStatus: 'not_started',
      requiredDns: [],
      nextCheckAt: new Date(),
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

  it('moves through pending/verified states and never routes before TLS is active', async () => {
    const pending = await request('/api/v1/domain/status', auth)
    expect(pending.response.status).toBe(200)
    expect(pending.body?.data?.status).toBe('pending')
    expect(pending.body?.data?.tlsStatus).toBe('not_started')

    const verified = await request('/api/v1/domain/verify', auth, { method: 'POST', body: '{}' })
    expect(verified.response.status).toBe(200)
    expect(verified.body?.data?.status).toBe('verified')
    expect(verified.body?.data?.tlsStatus).toBe('provisioning')

    const beforeTls = await request(`/api/v1/domain/resolve/${domain}`)
    expect(beforeTls.response.status).toBe(200)
    expect(beforeTls.body?.data?.organizationId).toBeNull()

    await DomainRecord.updateOne({ organizationId }, { $set: { tlsStatus: 'active' } })
    const routable = await request(`/api/v1/domain/resolve/${domain}`)
    expect(routable.response.status).toBe(200)
    expect(routable.body?.data?.organizationId).toBe(organizationId)
  })
})
