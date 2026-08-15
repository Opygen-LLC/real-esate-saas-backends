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
let PlatformSettings: any
let jwtHelpers: any
let config: any
let organizationId = ''
let owner: any
let property: any

const request = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...(init.headers || {}) },
  })
  const text = await response.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { response, body, text }
}

const futureDhakaSlot = () => {
  const start = new Date(Date.now() + 48 * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(start)
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return { date: `${byType.year}-${byType.month}-${byType.day}`, startTime: '11:00', endTime: '12:00' }
}

suite('phase 2 public forms and settings contracts', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'false'
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
    ;({ PlatformSettings } = await import('../../app/module/platformSettings/platformSettings.model'))
    ;({ jwtHelpers } = await import('../../app/helpers/jwtHelpers'))
    config = (await import('../../config')).default

    organizationId = 'org_phase2_forms'
    owner = await User.create({
      name: 'Phase Two Owner', email: 'owner@phase2.test', phoneNumber: '+8801711111111', password: 'unused-test-password',
      organizationId, userRole: 'agency_owner', status: 'active', isVerified: true,
    })
    await Organization.create({
      organizationId, agencyName: 'Phase Two Realty', agencyType: 'residential', ownerId: owner._id,
      email: 'office@phase2.test', phone: '+8801811111111', sub_domain: 'phase2-forms', websiteStatus: 'published',
      subscription: { plan: 'trial', status: 'trialing', maxProperties: 20, maxAgents: 5 },
    })
    property = await Property.create({
      organizationId, slug: 'phase2-no-agent-property', title: 'Phase Two Apartment', propertyType: 'Apartment', listingType: 'ForSale',
      status: 'Available', price: 9000000, currency: 'BDT', city: 'Dhaka', country: 'Bangladesh',
    })
    await PlatformSettings.create({
      key: 'platform',
      privacy: { policyUrl: 'https://example.test/privacy', policyVersion: 'phase2-policy-v1', retentionDays: 365, legalReviewStatus: 'approved', legalReviewedAt: new Date() },
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

  it('publishes the approved privacy version and readiness before public forms are enabled', async () => {
    const result = await request('/api/v1/platform-settings/public')
    expect(result.response.status).toBe(200)
    expect(result.body?.data?.privacy).toMatchObject({
      ready: true,
      policyUrl: 'https://example.test/privacy',
      policyVersion: 'phase2-policy-v1',
      legalReviewStatus: 'approved',
    })
  })

  it('accepts the contact form with Bangla phone digits and normalized optional email', async () => {
    const result = await request('/api/v1/lead/public-capture', {
      method: 'POST',
      body: JSON.stringify({ organizationId, name: 'Contact Buyer', phone: '০১৭১২-৩৪৫৬৭৮', email: 'BUYER@EXAMPLE.COM ', message: 'General contact form', privacyConsent: true, policyVersion: 'phase2-policy-v1' }),
    })
    expect(result.response.status).toBe(201)
    expect(result.body?.data?.phone).toBe('+8801712345678')
    expect(result.body?.data?.email).toBe('buyer@example.com')
  })

  it('accepts the agent contact form contract and returns field errors for invalid identity input', async () => {
    const valid = await request('/api/v1/lead/public-capture', {
      method: 'POST',
      body: JSON.stringify({ organizationId, name: 'Agent Prospect', phone: '01812345678', email: 'agent-prospect@example.com', message: 'Inquiry for broker profile', privacyConsent: true, policyVersion: 'phase2-policy-v1' }),
    })
    expect(valid.response.status).toBe(201)

    const invalid = await request('/api/v1/lead/public-capture', {
      method: 'POST',
      body: JSON.stringify({ organizationId, name: 'Invalid Prospect', phone: '1234', email: 'not-an-email', privacyConsent: true, policyVersion: 'phase2-policy-v1' }),
    })
    expect(invalid.response.status).toBe(400)
    expect(invalid.body?.code).toBe('VALIDATION_ERROR')
    expect(invalid.body?.fieldErrors?.phone?.[0]).toMatch(/Bangladesh mobile/i)
    expect(invalid.body?.fieldErrors?.email?.[0]).toMatch(/valid email/i)
  })

  it('accepts a property enquiry and rejects an outdated privacy version with a field error', async () => {
    const valid = await request('/api/v1/lead/public-capture', {
      method: 'POST',
      body: JSON.stringify({ organizationId, name: 'Property Buyer', phone: '01912345678', propertyInterest: property._id.toString(), message: 'Interested in this apartment', privacyConsent: true, policyVersion: 'phase2-policy-v1' }),
    })
    expect(valid.response.status).toBe(201)
    expect(valid.body?.data?.propertyInterest?.map(String)).toContain(property._id.toString())

    const stale = await request('/api/v1/lead/public-capture', {
      method: 'POST',
      body: JSON.stringify({ organizationId, name: 'Stale Policy Buyer', phone: '01612345678', privacyConsent: true, policyVersion: 'old-policy' }),
    })
    expect(stale.response.status).toBe(409)
    expect(stale.body?.code).toBe('PRIVACY_POLICY_OUTDATED')
    expect(stale.body?.fieldErrors?.policyVersion?.[0]).toMatch(/policy changed/i)
  })

  it('schedules a public viewing without a property agent by falling back to the agency owner', async () => {
    const slot = futureDhakaSlot()
    const result = await request('/api/v1/viewing/public-request', {
      method: 'POST',
      body: JSON.stringify({ organizationId, propertyId: property._id.toString(), ...slot, clientName: 'Viewing Buyer', clientPhone: '01312345678', clientEmail: 'viewing@example.com', privacyConsent: true, policyVersion: 'phase2-policy-v1' }),
    })
    expect(result.response.status).toBe(201)
    expect(String(result.body?.data?.agentId)).toBe(String(owner._id))
    expect(result.body?.data?.clientPhone).toBe('+8801312345678')
  })

  it('rejects invalid appointment windows with date/time field errors', async () => {
    const result = await request('/api/v1/viewing/public-request', {
      method: 'POST',
      body: JSON.stringify({ organizationId, propertyId: property._id.toString(), date: '2020-01-01', startTime: '12:00', endTime: '11:00', clientName: 'Past Buyer', clientPhone: '01512345678', privacyConsent: true, policyVersion: 'phase2-policy-v1' }),
    })
    expect(result.response.status).toBe(400)
    expect(result.body?.fieldErrors?.startTime?.[0]).toMatch(/future/i)
    expect(result.body?.fieldErrors?.endTime?.[0]).toMatch(/after start/i)
  })

  it('keeps profile, branding and domain-style fields separated while allowing Bangla profile settings', async () => {
    const token = jwtHelpers.createToken({ _id: owner._id.toString(), phoneNumber: owner.phoneNumber, email: owner.email, userRole: owner.userRole, organizationId }, config.jwt.secret, config.jwt.expires_in)
    const auth = { authorization: `Bearer ${token}` }

    const profile = await request('/api/v1/organization/update', {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ defaultLanguage: 'bn', email: 'OFFICE.NEW@EXAMPLE.COM ', phone: '০১৮১৯-৯৯৯৯৯৯', city: 'Dhaka' }),
    })
    expect(profile.response.status).toBe(200)
    expect(profile.body?.data?.defaultLanguage).toBe('bn')
    expect(profile.body?.data?.email).toBe('office.new@example.com')
    expect(profile.body?.data?.phone).toBe('+8801819999999')

    const wrongProfile = await request('/api/v1/organization/update', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ primaryColor: '#112233' }),
    })
    expect(wrongProfile.response.status).toBe(400)
    expect(wrongProfile.body?.fieldErrors?.primaryColor?.[0]).toBeTruthy()

    const branding = await request('/api/v1/organization/branding', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ primaryColor: '#112233', logo: 'https://example.test/logo.png' }),
    })
    expect(branding.response.status).toBe(200)
    expect(branding.body?.data?.primaryColor).toBe('#112233')

    const wrongBranding = await request('/api/v1/organization/branding', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ city: 'Chattogram' }),
    })
    expect(wrongBranding.response.status).toBe(400)
    expect(wrongBranding.body?.fieldErrors?.city?.[0]).toBeTruthy()
  })
})
