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
let Contact: any
let Viewing: any
let LeadService: any
let CalendarSyncService: any
let OrganizationService: any
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
  let contactB: any
  let corruptLeadA: any
  let viewingB: any
  let agentB: any

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = requiredDb!; process.env.REDIS_ENABLED = 'false'; process.env.WORKER_ENABLED = 'false'; process.env.SMS_DEV_MODE = 'true'
    process.env.CLIENT_URL = 'http://localhost:3000'; process.env.PUBLIC_API_URL = 'http://127.0.0.1:5000'; process.env.ALLOWED_ORIGINS = 'http://localhost:3000'
    mongoose = await import('mongoose'); await mongoose.connect(requiredDb!, { autoIndex: true }); await mongoose.connection.dropDatabase()
    ;({ User } = await import('../../app/module/user/user.model')); ({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ Property } = await import('../../app/module/property/property.model')); ({ Lead } = await import('../../app/module/lead/lead.model')); ({ Task } = await import('../../app/module/task/task.model'))
    ;({ Contact } = await import('../../app/module/contact/contact.model')); ({ Viewing } = await import('../../app/module/viewing/viewing.model'))
    ;({ LeadService } = await import('../../app/module/lead/lead.service')); ({ CalendarSyncService } = await import('../../app/module/crm/calendarSync.service')); ({ OrganizationService } = await import('../../app/module/organization/organization.service'))
    ;({ jwtHelpers } = await import('../../app/helpers/jwtHelpers')); config = (await import('../../config')).default
    const app = (await import('../../app')).default
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { const address = server.address(); if (!address || typeof address === 'string') throw new Error('bind failed'); baseUrl = `http://127.0.0.1:${address.port}`; resolve() }) })

    tenantA = 'org_phase7_a'; tenantB = 'org_phase7_b'
    await Organization.create([
      { organizationId: tenantA, agencyName: 'Tenant A', email: 'a@agency.test', phone: '+8801911111111', sub_domain: 'phase7-a', subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 2 } },
      { organizationId: tenantB, agencyName: 'Tenant B', email: 'b@agency.test', phone: '+8801922222222', sub_domain: 'phase7-b', subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 2 } },
    ])
    authA = await authHeader(tenantA, '11111111')
    agentB = await User.create({ name: 'Tenant B Agent', email: 'agent-b@example.com', phoneNumber: '+8801712345678', password: 'hash-is-not-used', organizationId: tenantB, userRole: 'agent', status: 'active', isVerified: true })
    propertyB = await Property.create({ organizationId: tenantB, slug: 'tenant-b-property', title: 'Tenant B Property', propertyType: 'Apartment', listingType: 'ForSale', status: 'Available', price: 1000000, currency: 'BDT', country: 'Bangladesh' })
    leadB = await Lead.create({ organizationId: tenantB, name: 'Tenant B Lead', phone: '+8801811111111', normalizedPhone: '+8801811111111', source: 'Website', leadStatus: 'New', currency: 'BDT' })
    contactB = await Contact.create({ organizationId: tenantB, name: 'Tenant B Contact', email: 'contact-b@example.com', phone: '+8801812222222', normalizedPhone: '+8801812222222', type: 'Buyer' })
    corruptLeadA = await Lead.create({ organizationId: tenantA, name: 'Legacy Corrupt Lead A', phone: '+8801813333333', normalizedPhone: '+8801813333333', source: 'Website', leadStatus: 'New', currency: 'BDT', contactId: contactB._id })
    taskB = await Task.create({ organizationId: tenantB, title: 'Tenant B Task', dueAt: new Date(Date.now() + 86400000), dueDate: '2026-08-20', dueTime: '09:00', taskType: 'general', priority: 'medium', status: 'Pending' })
    viewingB = await Viewing.create({ organizationId: tenantB, propertyId: propertyB._id, leadId: leadB._id, agentId: agentB._id, date: '2026-09-15', startTime: '10:00', endTime: '11:00', status: 'Scheduled', clientName: 'Tenant B Client', clientPhone: '+8801814444444' })
  }, 20_000)

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })



  it('rejects Tenant A creating a lead that references Tenant B property', async () => {
    const result = await request('/api/v1/lead', authA, {
      method: 'POST',
      body: JSON.stringify({ name: 'Cross Tenant Lead', phone: '+8801815555555', source: 'Website', propertyInterest: [propertyB._id.toString()] }),
    })
    expect(result.response.status).toBe(400)
  })

  it('does not populate a corrupt cross-tenant contact reference', async () => {
    const lead: any = await LeadService.getLeadById(tenantA, corruptLeadA._id.toString())
    expect(lead).toBeTruthy()
    expect(lead.contactId).toBeNull()
    expect(JSON.stringify(lead)).not.toContain('contact-b@example.com')
  })

  it('rejects a cross-tenant property relationship on Task creation', async () => {
    const result = await request('/api/v1/task', authA, {
      method: 'POST',
      body: JSON.stringify({ title: 'Invalid Tenant Task', dueAt: new Date(Date.now() + 86_400_000).toISOString(), taskType: 'general', linkedProperty: propertyB._id.toString() }),
    })
    expect(result.response.status).toBe(400)
  })

  it('rejects a cross-tenant property relationship on Finance transaction creation', async () => {
    const result = await request('/api/v1/finance/transactions', authA, {
      method: 'POST',
      body: JSON.stringify({ type: 'expense', category: 'Inspection', amount: 1000, transactionDate: new Date().toISOString(), paymentMethod: 'cash', status: 'paid', description: 'Cross tenant property attempt', propertyId: propertyB._id.toString() }),
    })
    expect(result.response.status).toBe(400)
  })

  it('Calendar Sync cannot load a viewing from another tenant', async () => {
    await expect(CalendarSyncService.syncViewing(tenantA, viewingB._id.toString())).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects duplicate requested subdomains at organization creation', async () => {
    await expect(OrganizationService.createOrganization({
      organizationId: 'org_phase1_duplicate_subdomain', agencyName: 'Duplicate Subdomain', email: 'duplicate@agency.test', phone: '+8801933333333', sub_domain: 'phase7-a',
    })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('allows legacy blank subdomain records without blocking new organization creation', async () => {
    await Organization.create({ organizationId: 'org_phase1_legacy_blank', agencyName: 'Legacy Blank', email: 'legacyblank@agency.test', phone: '+8801944444444', sub_domain: '' })
    const created: any = await OrganizationService.createOrganization({ organizationId: 'org_phase1_new_after_blank', agencyName: 'Fresh Agency', email: 'fresh@agency.test', phone: '+8801955555555' })
    expect(created.sub_domain).toMatch(/^fresh-agency-/)
    expect(created.sub_domain).not.toBe('')
  })

  it.each([
    ['GET property', () => request(`/api/v1/property/${propertyB._id}`, authA), 404],
    ['PATCH property', () => request(`/api/v1/property/${propertyB._id}`, authA, { method: 'PATCH', body: JSON.stringify({ title: 'Stolen' }) }), 404],
    ['DELETE property', () => request(`/api/v1/property/${propertyB._id}`, authA, { method: 'DELETE' }), 404],
    ['GET lead', () => request(`/api/v1/lead/${leadB._id}`, authA), 404],
    ['PATCH lead', () => request(`/api/v1/lead/${leadB._id}`, authA, { method: 'PATCH', body: JSON.stringify({ name: 'Cross tenant' }) }), 404],
    ['DELETE lead', () => request(`/api/v1/lead/${leadB._id}`, authA, { method: 'DELETE' }), 404],
    ['PATCH task', () => request(`/api/v1/task/${taskB._id}`, authA, { method: 'PATCH', body: JSON.stringify({ title: 'Cross tenant task' }) }), 404],
    ['DELETE task', () => request(`/api/v1/task/${taskB._id}`, authA, { method: 'DELETE' }), 404],
  ])('blocks %s even when the victim Mongo id is known', async (_name, run, expected) => {
    const result = await run()
    expect(result.response.status).toBe(expected)
  })
})
