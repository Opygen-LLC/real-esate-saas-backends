import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip
let server: Server
let baseUrl = ''
let mongoose: typeof import('mongoose')
let User: any
let Organization: any
let WebsiteSubmission: any
let jwtHelpers: any
let config: any

const authHeader = async (organizationId: string, suffix: string) => {
  const user = await User.create({
    name: `Owner ${suffix}`,
    email: `owner-submission-${suffix}@example.com`,
    phoneNumber: `+88017${suffix.padStart(8, '0').slice(-8)}`,
    password: 'hash-is-not-used',
    organizationId,
    userRole: 'agency_owner',
    status: 'active',
    isVerified: true,
  })
  return { authorization: `Bearer ${jwtHelpers.createToken({ _id: user._id.toString(), phoneNumber: user.phoneNumber, email: user.email, userRole: user.userRole, organizationId }, config.jwt.secret, config.jwt.expires_in)}` }
}

const request = async (path: string, headers: Record<string, string>, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...headers, ...(init.headers || {}) } })
  const text = await response.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { response, body }
}

suite('website submission tenant isolation and status workflow', () => {
  let tenantA: string
  let tenantB: string
  let authA: Record<string, string>
  let authB: Record<string, string>
  let submissionA: any
  let submissionB: any

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
    ;({ WebsiteSubmission } = await import('../../app/module/websiteSubmission/websiteSubmission.model'))
    ;({ jwtHelpers } = await import('../../app/helpers/jwtHelpers'))
    config = (await import('../../config')).default
    const app = (await import('../../app')).default
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('bind failed')
        baseUrl = `http://127.0.0.1:${address.port}`
        resolve()
      })
    })

    tenantA = 'org_submission_a'
    tenantB = 'org_submission_b'
    await Organization.create([
      { organizationId: tenantA, agencyName: 'Submission A', email: 'submission-a@agency.test', phone: '+8801911111111', sub_domain: 'submission-a', subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 2 } },
      { organizationId: tenantB, agencyName: 'Submission B', email: 'submission-b@agency.test', phone: '+8801922222222', sub_domain: 'submission-b', subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 2 } },
    ])
    authA = await authHeader(tenantA, '10000001')
    authB = await authHeader(tenantB, '10000002')
    submissionA = await WebsiteSubmission.create({ organizationId: tenantA, submissionType: 'CONTACT', status: 'NEW', name: 'Tenant A Visitor', phone: '+8801711111111', linkedEntityType: 'Lead', linkedEntityId: new mongoose.Types.ObjectId(), submittedAt: new Date() })
    submissionB = await WebsiteSubmission.create({ organizationId: tenantB, submissionType: 'GENERAL_LEAD', status: 'NEW', name: 'Tenant B Visitor', phone: '+8801722222222', linkedEntityType: 'Lead', linkedEntityId: new mongoose.Types.ObjectId(), submittedAt: new Date() })
  }, 20_000)

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('lists only the authenticated tenant submissions', async () => {
    const result = await request('/api/v1/website-submissions?limit=50', authA)
    expect(result.response.status).toBe(200)
    expect(result.body?.data?.map((row: any) => row._id)).toContain(String(submissionA._id))
    expect(result.body?.data?.map((row: any) => row._id)).not.toContain(String(submissionB._id))
  })

  it('cannot read or mutate another tenant submission by known Mongo id', async () => {
    const getResult = await request(`/api/v1/website-submissions/${submissionB._id}`, authA)
    expect(getResult.response.status).toBe(404)
    const patchResult = await request(`/api/v1/website-submissions/${submissionB._id}/status`, authA, { method: 'PATCH', body: JSON.stringify({ status: 'PROCESSED' }) })
    expect(patchResult.response.status).toBe(404)
  })

  it('tracks read and processed timestamps for the owning tenant', async () => {
    const readResult = await request(`/api/v1/website-submissions/${submissionA._id}/status`, authA, { method: 'PATCH', body: JSON.stringify({ status: 'READ' }) })
    expect(readResult.response.status).toBe(200)
    expect(readResult.body?.data?.status).toBe('READ')
    expect(readResult.body?.data?.readAt).toBeTruthy()

    const processedResult = await request(`/api/v1/website-submissions/${submissionA._id}/status`, authA, { method: 'PATCH', body: JSON.stringify({ status: 'PROCESSED' }) })
    expect(processedResult.response.status).toBe(200)
    expect(processedResult.body?.data?.processedAt).toBeTruthy()
  })

  it('tenant B still sees its own submission', async () => {
    const result = await request(`/api/v1/website-submissions/${submissionB._id}`, authB)
    expect(result.response.status).toBe(200)
  })
})
