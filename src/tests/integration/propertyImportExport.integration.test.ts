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
let authA: Record<string, string>
const tenantA = 'phase10-property-import-a'
const tenantB = 'phase10-property-import-b'

const jsonRequest = async (path: string, headers: Record<string, string>, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...headers, ...(init.headers || {}) },
  })
  const text = await response.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { response, body, text }
}

suite('Phase 10 property import/export production acceptance', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'true'
    process.env.REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1'
    process.env.REDIS_PORT = process.env.REDIS_PORT || '6379'
    process.env.WORKER_ENABLED = 'false'
    process.env.SMS_DEV_MODE = 'true'
    process.env.EMAIL_DEV_MODE = 'true'
    process.env.CLIENT_URL = 'http://localhost:3000'
    process.env.PUBLIC_API_URL = 'http://127.0.0.1:5000'
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

    mongoose = await import('mongoose')
    await mongoose.connect(requiredDb!, { autoIndex: true, serverSelectionTimeoutMS: 5000 })
    await mongoose.connection.dropDatabase()
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ Property } = await import('../../app/module/property/property.model'))
    ;({ jwtHelpers } = await import('../../app/helpers/jwtHelpers'))
    config = (await import('../../config')).default

    await Organization.create([
      { organizationId: tenantA, agencyName: 'Phase 10 Import A', email: 'import-a@example.test', phone: '+8801711111111', sub_domain: 'phase10-import-a', subscription: { plan: 'trial', status: 'trialing', maxProperties: 100, maxAgents: 5 } },
      { organizationId: tenantB, agencyName: 'Phase 10 Import B', email: 'import-b@example.test', phone: '+8801722222222', sub_domain: 'phase10-import-b', subscription: { plan: 'trial', status: 'trialing', maxProperties: 100, maxAgents: 5 } },
    ])
    const ownerA = await User.create({ name: 'Import Owner A', email: 'owner-import-a@example.test', phoneNumber: '+8801733333333', password: 'unused', organizationId: tenantA, userRole: 'agency_owner', status: 'active', isVerified: true })
    await User.create({ name: 'Import Owner B', email: 'owner-import-b@example.test', phoneNumber: '+8801744444444', password: 'unused', organizationId: tenantB, userRole: 'agency_owner', status: 'active', isVerified: true })
    const token = jwtHelpers.createToken({ _id: ownerA._id.toString(), phoneNumber: ownerA.phoneNumber, email: ownerA.email, userRole: ownerA.userRole, organizationId: tenantA }, config.jwt.secret, config.jwt.expires_in)
    authA = { authorization: `Bearer ${token}` }

    await Property.create([
      { organizationId: tenantA, title: 'Dhaka Existing', slug: 'dhaka-existing', propertyType: 'Apartment', listingType: 'ForSale', status: 'Draft', price: 2000000, currency: 'BDT', country: 'Bangladesh', city: 'Dhaka' },
      { organizationId: tenantA, title: 'Chattogram Existing', slug: 'chattogram-existing', propertyType: 'Apartment', listingType: 'ForSale', status: 'Draft', price: 3000000, currency: 'BDT', country: 'Bangladesh', city: 'Chattogram' },
      { organizationId: tenantB, title: 'Tenant B Dhaka', slug: 'tenant-b-dhaka', propertyType: 'Apartment', listingType: 'ForSale', status: 'Draft', price: 1000000, currency: 'BDT', country: 'Bangladesh', city: 'Dhaka' },
    ])

    const app = (await import('../../app')).default
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind Phase 10 property integration server')
        baseUrl = `http://127.0.0.1:${address.port}`
        resolve()
      })
    })
  }, 20_000)

  afterAll(async () => {
    const { RedisClient } = await import('../../shared/redisClient')
    RedisClient.close()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('previews invalid rows without writing them, then confirms only validated rows once', async () => {
    const csv = [
      'title,propertyType,listingType,status,price,currency,postalCode,city',
      'Valid Imported,Apartment,ForSale,Draft,1500000,BDT,1212,Dhaka',
      'Invalid Imported,UnknownType,ForSale,Draft,-10,BDT,not-a-postcode,Dhaka',
    ].join('\n')
    const form = new FormData()
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'phase10-properties.csv')
    const previewResponse = await fetch(`${baseUrl}/api/v1/property/import/preview`, { method: 'POST', headers: authA, body: form })
    const preview = await previewResponse.json() as any
    expect(previewResponse.status).toBe(200)
    expect(preview.data).toMatchObject({ total: 2, valid: 1, invalid: 1 })
    expect(await Property.countDocuments({ organizationId: tenantA, title: { $in: ['Valid Imported', 'Invalid Imported'] } })).toBe(0)

    const confirm = await jsonRequest('/api/v1/property/import/confirm', authA, {
      method: 'POST',
      body: JSON.stringify({ importSessionId: preview.data.importSessionId }),
    })
    expect(confirm.response.status).toBe(200)
    expect(confirm.body?.data).toMatchObject({ total: 2, created: 1, failed: 1 })
    expect(await Property.countDocuments({ organizationId: tenantA, title: 'Valid Imported' })).toBe(1)
    expect(await Property.countDocuments({ organizationId: tenantA, title: 'Invalid Imported' })).toBe(0)

    const replay = await jsonRequest('/api/v1/property/import/confirm', authA, {
      method: 'POST',
      body: JSON.stringify({ importSessionId: preview.data.importSessionId }),
    })
    expect(replay.response.status).toBe(410)
    expect(await Property.countDocuments({ organizationId: tenantA, title: 'Valid Imported' })).toBe(1)
  })

  it('exports only the authenticated tenant rows matching the applied server filters', async () => {
    const response = await fetch(`${baseUrl}/api/v1/property/export/csv?city=Dhaka&sortBy=price&sortOrder=asc`, { headers: authA })
    const csv = await response.text()
    expect(response.status).toBe(200)
    expect(csv).toContain('Dhaka Existing')
    expect(csv).toContain('Valid Imported')
    expect(csv).not.toContain('Chattogram Existing')
    expect(csv).not.toContain('Tenant B Dhaka')
  })
})
