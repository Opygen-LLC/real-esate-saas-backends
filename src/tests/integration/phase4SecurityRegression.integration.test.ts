import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip
let server: Server
let baseUrl = ''
let mongoose: typeof import('mongoose')
let User: any
let Organization: any
let Property: any
let jwtHelpers: any
let config: any

const tokenFor = async (organizationId: string, role: string, suffix: string) => {
  const user = await User.create({
    name: `${role} ${suffix}`,
    email: `${role}-${suffix}@example.com`,
    phoneNumber: `+88018${suffix.padStart(8, '0').slice(-8)}`,
    password: 'hash-is-not-used',
    organizationId,
    userRole: role,
    status: 'active',
    isVerified: true,
  })
  return `Bearer ${jwtHelpers.createToken({ _id: user._id.toString(), phoneNumber: user.phoneNumber, email: user.email, userRole: user.userRole, organizationId }, config.jwt.secret, config.jwt.expires_in)}`
}
const request = async (path: string, authorization?: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers || {})
  headers.set('content-type', 'application/json')
  if (authorization) headers.set('authorization', authorization)
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers })
  const text = await response.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { response, body, text }
}

suite('Phase 4 privileged-resource four-scenario security matrix', () => {
  const tenantA = 'org_phase4_security_a'
  const tenantB = 'org_phase4_security_b'
  let ownerA = ''
  let ownerB = ''
  let agentA = ''
  let propertyA: any
  let propertyB: any

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'false'
    process.env.WORKER_ENABLED = 'false'
    process.env.SMS_DEV_MODE = 'true'
    process.env.CLIENT_URL = 'http://localhost:3000'
    process.env.PUBLIC_API_URL = 'http://127.0.0.1:5000'
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000'
    mongoose = await import('mongoose')
    await mongoose.connect(requiredDb!, { autoIndex: true })
    await mongoose.connection.dropDatabase()
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ Property } = await import('../../app/module/property/property.model'))
    ;({ jwtHelpers } = await import('../../app/helpers/jwtHelpers'))
    config = (await import('../../config')).default
    await Organization.create([
      { organizationId: tenantA, agencyName: 'Security Tenant A', email: 'phase4-a@agency.test', phone: '+8801911111201', sub_domain: 'phase4-security-a', subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 5 } },
      { organizationId: tenantB, agencyName: 'Security Tenant B', email: 'phase4-b@agency.test', phone: '+8801911111202', sub_domain: 'phase4-security-b', subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 5 } },
    ])
    ownerA = await tokenFor(tenantA, 'agency_owner', '40000001')
    ownerB = await tokenFor(tenantB, 'agency_owner', '40000002')
    agentA = await tokenFor(tenantA, 'agent', '40000003')
    propertyA = await Property.create({ organizationId: tenantA, slug: 'phase4-a-property', title: 'Tenant A Property', propertyType: 'Apartment', listingType: 'ForSale', status: 'Available', price: 1000000, currency: 'BDT', country: 'Bangladesh' })
    propertyB = await Property.create({ organizationId: tenantB, slug: 'phase4-b-property', title: 'Tenant B Property', propertyType: 'Apartment', listingType: 'ForSale', status: 'Available', price: 2000000, currency: 'BDT', country: 'Bangladesh' })
    const app = (await import('../../app')).default
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('bind failed')
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

  it('1/4 unauthenticated caller gets 401 for a privileged resource', async () => {
    const result = await request(`/api/v1/property/${propertyA._id}`)
    expect(result.response.status).toBe(401)
    expect(result.text).not.toContain('Tenant A Property')
  })

  it('2/4 authenticated user without delete permission gets 403', async () => {
    const result = await request(`/api/v1/property/${propertyA._id}`, agentA, { method: 'DELETE' })
    expect(result.response.status).toBe(403)
    expect(await Property.exists({ _id: propertyA._id, organizationId: tenantA })).toBeTruthy()
  })

  it('3/4 correctly privileged role from the wrong organization cannot enumerate the object', async () => {
    const result = await request(`/api/v1/property/${propertyB._id}`, ownerA)
    expect([403, 404]).toContain(result.response.status)
    expect(result.text).not.toContain('Tenant B Property')
  })

  it('4/4 correctly authorized tenant owner can read its own object', async () => {
    const result = await request(`/api/v1/property/${propertyB._id}`, ownerB)
    expect(result.response.status).toBe(200)
    expect(result.text).toContain('Tenant B Property')
  })

  it('never allows a tenant token into platform-admin endpoints', async () => {
    const result = await request('/api/v1/platform-admin/search', ownerA)
    expect(result.response.status).toBe(403)
  })
})
