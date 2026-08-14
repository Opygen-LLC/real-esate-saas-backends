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
let BkashPaymentClient: any
let readCapturedOtpForTest: (identity: string, purpose: string) => string | null

const request = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...(init.headers || {}) },
    redirect: init.redirect || 'manual',
  })
  const text = await response.text()
  let body: Json | null = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { response, body, text }
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
    ;({ BkashPaymentClient } = await import('../../app/module/bkashPayment/bkashPayment.client'))
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

  it('covers signup -> OTP -> onboarding -> property -> publish -> public lead -> CRM -> bKash -> invoice', async () => {
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

    vi.spyOn(BkashPaymentClient, 'createPayment').mockResolvedValue({ paymentID: 'PHASE7PAY', bkashURL: 'https://tokenized.pay.bka.sh/checkout/PHASE7PAY', statusCode: '0000', statusMessage: 'Successful', amount: String(starter.priceMonthly), currency: 'BDT' })
    vi.spyOn(BkashPaymentClient, 'executePayment').mockResolvedValue({ paymentID: 'PHASE7PAY', statusCode: '0000', statusMessage: 'Successful', amount: String(starter.priceMonthly), currency: 'BDT', trxID: 'TRXPHASE7', payerAccount: '01700000000', transactionStatus: 'Completed' })

    const checkout = await request('/api/v1/billing/bkash/create', {
      method: 'POST', headers: { ...auth, 'idempotency-key': 'phase7-checkout-key' }, body: JSON.stringify({ planId: 'starter', billingCycle: 'monthly' }),
    })
    expect(checkout.response.status).toBe(201)
    expect(checkout.body?.data?.paymentId).toBe('PHASE7PAY')

    const duplicateCheckout = await request('/api/v1/billing/bkash/create', {
      method: 'POST', headers: { ...auth, 'idempotency-key': 'phase7-checkout-key' }, body: JSON.stringify({ planId: 'starter', billingCycle: 'monthly' }),
    })
    expect(duplicateCheckout.response.status).toBe(201)
    expect(duplicateCheckout.body?.data?.paymentId).toBe('PHASE7PAY')
    expect(BkashPaymentClient.createPayment).toHaveBeenCalledTimes(1)

    const callback = await request('/api/v1/billing/bkash/callback?paymentID=PHASE7PAY&status=success')
    expect(callback.response.status).toBeGreaterThanOrEqual(300)
    expect(callback.response.status).toBeLessThan(400)
    expect(callback.response.headers.get('location')).toContain('/payment/bkash/success')

    const billing = await request('/api/v1/billing/history', { headers: auth })
    expect(billing.response.status).toBe(200)
    expect(billing.body?.data?.some((row: any) => row.paymentId === 'PHASE7PAY' && row.status === 'paid')).toBe(true)
  }, 30_000)
})
