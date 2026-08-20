import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip

type Json = Record<string, any>
let server: Server
let baseUrl = ''
let mongoose: typeof import('mongoose')
let User: any
let Organization: any
let SubscriptionPlan: any
let PlatformSettings: any
let readCapturedOtpForTest: (identity: string, purpose: string) => string | null

const request = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...(init.headers || {}) },
    redirect: init.redirect || 'manual',
  })
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/pdf')) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    return { response, body: null as Json | null, text: '', bytes }
  }
  const text = await response.text()
  let body: Json | null = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { response, body, text, bytes: new Uint8Array() }
}

const bearerFor = async (phoneNumber: string) => {
  const user = await User.findOne({ phoneNumber }).lean()
  const { jwtHelpers } = await import('../../app/helpers/jwtHelpers')
  const config = (await import('../../config')).default
  return jwtHelpers.createToken({ _id: user._id.toString(), phoneNumber: user.phoneNumber, email: user.email, userRole: user.userRole, organizationId: user.organizationId }, config.jwt.secret as any, config.jwt.expires_in)
}

suite('production journey integration', () => {
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
    ;({ SubscriptionPlan } = await import('../../app/module/subscriptionPlan/subscriptionPlan.model'))
    ;({ PlatformSettings } = await import('../../app/module/platformSettings/platformSettings.model'))
    await PlatformSettings.create({ key: 'platform', privacy: { policyUrl: 'https://example.test/privacy', policyVersion: 'phase7-test', retentionDays: 365, legalReviewStatus: 'approved', legalReviewedAt: new Date() } })
    await SubscriptionPlan.create({ planId: 'starter', version: 1, name: 'Starter', priceMonthly: 1490, priceYearly: 14900, currency: 'BDT', features: ['Core CRM'], maxAgents: 3, maxProperties: 100, maxLeads: 500, isActive: true, isCurrent: true, effectiveFrom: new Date(), grandfatherExisting: true })
    await User.create({ name: 'Platform Admin', email: 'admin-phase1@example.com', phoneNumber: '+8801999999999', password: 'unused-test-password', organizationId: 'platform', userRole: 'super-admin', status: 'active', isVerified: true })
    ;({ readCapturedOtpForTest } = await import('../../testSupport/otpCapture'))
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
    vi.restoreAllMocks()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('covers signup -> OTP -> onboarding -> property -> publish -> public lead -> CRM -> manual subscription payment -> receipt', async () => {
    const register = await request('/api/v1/auth/register-agency', {
      method: 'POST',
      body: JSON.stringify({ name: 'Phase Seven Owner', email: 'phase7@example.com', phoneNumber: '01712345678', password: 'Production123!', agencyName: 'Phase Seven Realty', agencyType: 'residential' }),
    })
    expect(register.response.status).toBe(201)
    expect(register.body?.data?.subdomain).toBeTruthy()

    const normalizedPhone = '+8801712345678'
    const otp = readCapturedOtpForTest('phase7@example.com', 'account_verification')
    expect(otp).toMatch(/^\d{6}$/)
    const verify = await request('/api/v1/auth/verify', { method: 'POST', body: JSON.stringify({ email: 'phase7@example.com', verificationCode: otp }) })
    expect(verify.response.status).toBe(200)
    const token = await bearerFor(normalizedPhone)
    const auth = { authorization: `Bearer ${token}` }

    const onboarding = await request('/api/v1/organization/update', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ city: 'Dhaka', defaultLanguage: 'en', addressDetails: { divisionId: '30', division: 'Dhaka', district: 'Dhaka', road: 'Road 11' } }),
    })
    expect(onboarding.response.status).toBe(200)

    const property = await request('/api/v1/property', {
      method: 'POST', headers: auth, body: JSON.stringify({ title: 'Phase Seven Apartment', propertyType: 'Apartment', listingType: 'ForSale', status: 'Available', price: 12500000, currency: 'BDT', area: 1450, areaUnit: 'sqft', city: 'Dhaka', country: 'Bangladesh' }),
    })
    expect(property.response.status).toBe(201)
    const propertyId = property.body?.data?._id
    expect(propertyId).toMatch(/^[a-f0-9]{24}$/)

    const propertyRead = await request(`/api/v1/property/${propertyId}`, { headers: auth })
    expect(propertyRead.response.status).toBe(200)
    expect(propertyRead.body?.data?.title).toBe('Phase Seven Apartment')
    const propertyUpdate = await request(`/api/v1/property/${propertyId}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ price: 12600000 }) })
    expect(propertyUpdate.response.status).toBe(200)
    expect(propertyUpdate.body?.data?.price).toBe(12600000)

    const pages = await request('/api/v1/organization/website/pages', { headers: auth })
    expect(pages.response.status).toBe(200)
    const pageId = pages.body?.data?.[0]?._id
    expect(pageId).toBeTruthy()
    const publish = await request(`/api/v1/organization/website/pages/${pageId}/publish`, { method: 'POST', headers: auth, body: '{}' })
    expect(publish.response.status).toBe(200)
    expect(publish.body?.data?.status).toBe('published')

    const organization = await Organization.findOne({ phone: normalizedPhone }).lean()
    const lead = await request('/api/v1/lead/public-capture', {
      method: 'POST', body: JSON.stringify({ organizationId: organization.organizationId, name: 'Interested Buyer', phone: '01812345678', email: 'buyer@example.com', propertyInterest: propertyId, message: 'Please arrange a viewing', privacyConsent: true, policyVersion: 'phase7-test', attribution: { utmSource: 'phase7-ci', utmCampaign: 'release-gate' } }),
    })
    expect(lead.response.status).toBe(201)
    const leadId = lead.body?.data?._id
    expect(leadId).toMatch(/^[a-f0-9]{24}$/)

    const crm = await request('/api/v1/lead?limit=10', { headers: auth })
    expect(crm.response.status).toBe(200)
    expect(crm.body?.data?.some((row: any) => row.phone === '+8801812345678')).toBe(true)
    const leadRead = await request(`/api/v1/lead/${leadId}`, { headers: auth })
    expect(leadRead.response.status).toBe(200)
    const leadUpdate = await request(`/api/v1/lead/${leadId}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ notes: 'Qualified during Phase 7 journey' }) })
    expect(leadUpdate.response.status).toBe(200)
    expect(leadUpdate.body?.data?.notes).toBe('Qualified during Phase 7 journey')

    const plans = await request('/api/v1/subscription/plans')
    expect(plans.response.status).toBe(200)
    const starter = plans.body?.data?.find((row: any) => row.planId === 'starter')
    expect(starter?.priceMonthly).toBeGreaterThan(0)

    const changeRequest = await request('/api/v1/billing/change-plan', {
      method: 'POST', headers: auth, body: JSON.stringify({ planId: 'starter', billingCycle: 'monthly' }),
    })
    expect(changeRequest.response.status).toBe(201)
    expect(changeRequest.body?.data?.status).toBe('pending_payment')
    expect(changeRequest.body?.data?.amount).toBe(starter.priceMonthly)
    const changeRequestId = changeRequest.body?.data?._id
    expect(changeRequestId).toMatch(/^[a-f0-9]{24}$/)

    const adminToken = await bearerFor('+8801999999999')
    const adminAuth = { authorization: `Bearer ${adminToken}` }
    const recorded = await request('/api/v1/platform-admin/payments', {
      method: 'POST', headers: adminAuth, body: JSON.stringify({ organizationId: organization.organizationId, changeRequestId, method: 'bank', reference: 'BANK-PHASE1-001', notes: 'Phase 1 integration payment' }),
    })
    expect(recorded.response.status).toBe(201)
    expect(recorded.body?.data?.status).toBe('pending')
    const paymentNumber = recorded.body?.data?.paymentNumber
    expect(paymentNumber).toMatch(/^PAY-/)

    const beforeConfirm = await Organization.findOne({ organizationId: organization.organizationId }).lean()
    expect(beforeConfirm?.subscription?.plan).toBe('trial')

    const confirmed = await request(`/api/v1/platform-admin/payments/${paymentNumber}/decision`, {
      method: 'PATCH', headers: adminAuth, body: JSON.stringify({ status: 'confirmed', reason: 'Bank reference verified in integration test' }),
    })
    expect(confirmed.response.status).toBe(200)
    expect(confirmed.body?.data?.status).toBe('confirmed')
    expect(confirmed.body?.data?.receiptNumber).toMatch(/^RCT-/)

    const activated = await Organization.findOne({ organizationId: organization.organizationId }).lean()
    expect(activated?.subscription?.plan).toBe('starter')
    expect(activated?.subscription?.status).toBe('active')
    expect(activated?.subscription?.source).toBe('manual_payment')

    const billing = await request('/api/v1/billing/history', { headers: auth })
    expect(billing.response.status).toBe(200)
    expect(billing.body?.data?.some((row: any) => row.paymentNumber === paymentNumber && row.status === 'confirmed')).toBe(true)

    const receipt = await request(`/api/v1/billing/history/${paymentNumber}/receipt`, { headers: auth })
    expect(receipt.response.status).toBe(200)
    expect(receipt.response.headers.get('content-type')).toContain('application/pdf')
    expect(receipt.response.headers.get('content-disposition')).toMatch(/attachment; filename="opygen-estate-RCT-[^"]+\.pdf"/)
    expect(Buffer.from(receipt.bytes).subarray(0, 5).toString('ascii')).toBe('%PDF-')
  }, 30_000)
})
