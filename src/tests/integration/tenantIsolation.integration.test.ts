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
let Lead: any
let Task: any
let jwtHelpers: any
let config: any

const authHeader = async (organizationId: string, suffix: string) => {
  const user = await User.create({ name: `Owner ${suffix}`, email: `owner-${suffix}@example.com`, phoneNumber: `+88017${suffix.padStart(8, '0').slice(-8)}`, password: 'hash-is-not-used', organizationId, userRole: 'agency_owner', status: 'active', isVerified: true })
  return { authorization: `Bearer ${jwtHelpers.createToken({ _id: user._id.toString(), phoneNumber: user.phoneNumber, email: user.email, userRole: user.userRole, organizationId }, config.jwt.secret, config.jwt.expires_in)}` }
}

const request = async (path: string, headers: Record<string, string>, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...headers, ...(init.headers || {}) } })
  const text = await response.text(); let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { response, body }
}

suite('cross-tenant negative matrix', () => {
  let tenantA: string
  let tenantB: string
  let authA: Record<string, string>
  let propertyB: any
  let leadB: any
  let taskB: any

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = requiredDb!; process.env.REDIS_ENABLED = 'false'; process.env.WORKER_ENABLED = 'false'; process.env.SMS_DEV_MODE = 'true'
    process.env.CLIENT_URL = 'http://localhost:3000'; process.env.PUBLIC_API_URL = 'http://127.0.0.1:5000'; process.env.ALLOWED_ORIGINS = 'http://localhost:3000'
    mongoose = await import('mongoose'); await mongoose.connect(requiredDb!, { autoIndex: true }); await mongoose.connection.dropDatabase()
    ;({ User } = await import('../../app/module/user/user.model')); ({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ Property } = await import('../../app/module/property/property.model')); ({ Lead } = await import('../../app/module/lead/lead.model')); ({ Task } = await import('../../app/module/task/task.model'))
    ;({ jwtHelpers } = await import('../../app/helpers/jwtHelpers')); config = (await import('../../config')).default
    const app = (await import('../../app')).default
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { const address = server.address(); if (!address || typeof address === 'string') throw new Error('bind failed'); baseUrl = `http://127.0.0.1:${address.port}`; resolve() }) })

    tenantA = 'org_phase7_a'; tenantB = 'org_phase7_b'
    await Organization.create([
      { organizationId: tenantA, agencyName: 'Tenant A', email: 'a@agency.test', phone: '+8801911111111', sub_domain: 'phase7-a', subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 2 } },
      { organizationId: tenantB, agencyName: 'Tenant B', email: 'b@agency.test', phone: '+8801922222222', sub_domain: 'phase7-b', subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 2 } },
    ])
    authA = await authHeader(tenantA, '11111111')
    propertyB = await Property.create({ organizationId: tenantB, slug: 'tenant-b-property', title: 'Tenant B Property', propertyType: 'Apartment', listingType: 'ForSale', status: 'Available', price: 1000000, currency: 'BDT', country: 'Bangladesh' })
    leadB = await Lead.create({ organizationId: tenantB, name: 'Tenant B Lead', phone: '+8801811111111', normalizedPhone: '+8801811111111', source: 'Website', leadStatus: 'New', currency: 'BDT' })
    taskB = await Task.create({ organizationId: tenantB, title: 'Tenant B Task', dueAt: new Date(Date.now() + 86400000), dueDate: '2026-08-20', dueTime: '09:00', taskType: 'general', priority: 'medium', status: 'Pending' })
  }, 20_000)

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it.each([
    ['GET property', () => request(`/api/v1/property/${propertyB._id}`, authA), 404],
    ['PATCH property', () => request(`/api/v1/property/${propertyB._id}`, authA, { method: 'PATCH', body: JSON.stringify({ title: 'Stolen' }) }), 404],
    ['DELETE property', () => request(`/api/v1/property/${propertyB._id}`, authA, { method: 'DELETE' }), 404],
    ['GET lead', () => request(`/api/v1/lead/${leadB._id}`, authA), 404],
    ['PATCH lead', () => request(`/api/v1/lead/${leadB._id}`, authA, { method: 'PATCH', body: JSON.stringify({ notes: 'cross tenant' }) }), 404],
    ['DELETE lead', () => request(`/api/v1/lead/${leadB._id}`, authA, { method: 'DELETE' }), 404],
    ['PATCH task', () => request(`/api/v1/task/${taskB._id}`, authA, { method: 'PATCH', body: JSON.stringify({ title: 'Cross tenant task' }) }), 404],
    ['DELETE task', () => request(`/api/v1/task/${taskB._id}`, authA, { method: 'DELETE' }), 404],
  ])('blocks %s even when the victim Mongo id is known', async (_name, run, expected) => {
    const result = await run()
    expect(result.response.status).toBe(expected)
  })
})
