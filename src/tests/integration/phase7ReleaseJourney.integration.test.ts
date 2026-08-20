import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('dns/promises', () => ({
  default: {
    lookup: vi.fn(async (hostname: string) => hostname === 'phase7-media.example'
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '93.184.216.34', family: 4 }]),
    resolveTxt: vi.fn(async () => []),
    resolve4: vi.fn(async () => []),
    resolveCname: vi.fn(async () => []),
  },
}))

const databaseUrl = process.env.TEST_DATABASE_URL
const mediaEnabled = process.env.PHASE7_MEDIA_INTEGRATION === 'true'
const suite = databaseUrl ? describe : describe.skip

type Json = Record<string, any>
let server: Server
let baseUrl = ''
let mongoose: typeof import('mongoose')
let User: any
let Organization: any
let SubscriptionPlan: any
let PlatformSettings: any
let WebsiteAssetProcessor: any
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
  return jwtHelpers.createToken({
    _id: user._id.toString(), phoneNumber: user.phoneNumber, email: user.email,
    userRole: user.userRole, organizationId: user.organizationId,
  }, config.jwt.secret as any, config.jwt.expires_in)
}

const tomorrowInDhaka = () => {
  const date = new Date(Date.now() + 36 * 60 * 60_000)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZsWQAAAAASUVORK5CYII=',
  'base64',
)

suite('Phase 7 production release journey', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = databaseUrl!
    process.env.REDIS_ENABLED = 'false'
    process.env.WORKER_ENABLED = 'false'
    process.env.SMS_DEV_MODE = 'true'
    process.env.EMAIL_DEV_MODE = 'true'
    process.env.CLIENT_URL = 'http://localhost:3000'
    process.env.PUBLIC_API_URL = 'http://127.0.0.1:5000'
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

    mongoose = await import('mongoose')
    await mongoose.connect(databaseUrl!, { autoIndex: true, serverSelectionTimeoutMS: 5000 })
    await mongoose.connection.dropDatabase()
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ SubscriptionPlan } = await import('../../app/module/subscriptionPlan/subscriptionPlan.model'))
    ;({ PlatformSettings } = await import('../../app/module/platformSettings/platformSettings.model'))
    ;({ WebsiteAssetProcessor } = await import('../../app/module/websiteBuilder/websiteAssetProcessor.service'))

    await PlatformSettings.create({
      key: 'platform',
      privacy: { policyUrl: 'https://example.test/privacy', policyVersion: 'phase7-release', retentionDays: 365, legalReviewStatus: 'approved', legalReviewedAt: new Date() },
      support: { whatsapp: '+8801891793354', phone: '+8801891793354' },
    })
    await SubscriptionPlan.create([
      { planId: 'starter', version: 1, name: 'Starter', priceMonthly: 500, priceYearly: 5000, currency: 'BDT', features: ['Core CRM'], maxAgents: 3, maxProperties: 100, maxLeads: 500, isActive: true, isCurrent: true, effectiveFrom: new Date(), grandfatherExisting: true },
      { planId: 'professional', version: 1, name: 'Professional', priceMonthly: 1500, priceYearly: 15000, currency: 'BDT', features: ['Advanced CRM'], maxAgents: 10, maxProperties: 500, maxLeads: 5000, isActive: true, isCurrent: true, effectiveFrom: new Date(), grandfatherExisting: true },
    ])
    await User.create({ name: 'Platform Admin', email: 'phase7-admin@example.com', phoneNumber: '+8801999999999', password: 'unused-test-password', organizationId: 'platform', userRole: 'super-admin', status: 'active', isVerified: true })
    ;({ readCapturedOtpForTest } = await import('../../testSupport/otpCapture'))

    const app = (await import('../../app')).default
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind Phase 7 integration server')
        baseUrl = `http://127.0.0.1:${address.port}`
        resolve()
      })
    })
  }, 30_000)

  afterAll(async () => {
    vi.restoreAllMocks()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it.skipIf(!mediaEnabled)('runs register -> verify -> onboarding -> media -> publish -> enquiry -> viewing -> manual subscription -> receipt -> revenue', async () => {
    const register = await request('/api/v1/auth/register-agency', {
      method: 'POST',
      body: JSON.stringify({ name: 'Phase Seven Owner', email: 'phase7-release@example.com', phoneNumber: '01712345678', password: 'Production123!', agencyName: 'Phase Seven Realty', agencyType: 'residential' }),
    })
    expect(register.response.status).toBe(201)
    const normalizedPhone = '+8801712345678'
    const otp = readCapturedOtpForTest('phase7-release@example.com', 'account_verification')
    expect(otp).toMatch(/^\d{6}$/)
    const verify = await request('/api/v1/auth/verify', { method: 'POST', body: JSON.stringify({ email: 'phase7-release@example.com', verificationCode: otp }) })
    expect(verify.response.status).toBe(200)
    const token = await bearerFor(normalizedPhone)
    const auth = { authorization: `Bearer ${token}` }

    const onboarding = await request('/api/v1/organization/update', {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ city: 'Dhaka', defaultLanguage: 'bn', addressDetails: { divisionId: '30', division: 'Dhaka', district: 'Dhaka', road: 'Road 11' } }),
    })
    expect(onboarding.response.status).toBe(200)

    const org: any = await Organization.findOne({ phone: normalizedPhone })
    expect(org?.organizationId).toBeTruthy()
    const organizationId = org.organizationId

    const propertyCreate = await request('/api/v1/property', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ title: 'Phase Seven Apartment', propertyType: 'Apartment', listingType: 'ForSale', status: 'Draft', price: 12500000, currency: 'BDT', area: 1450, areaUnit: 'sqft', city: 'Dhaka', country: 'Bangladesh' }),
    })
    expect(propertyCreate.response.status).toBe(201)
    const propertyId = propertyCreate.body?.data?._id
    expect(propertyId).toMatch(/^[a-f0-9]{24}$/)

    const uploadedImages: Array<{ url: string; publicId: string; isFeatured: boolean; order: number }> = []
    for (let index = 0; index < 20; index += 1) {
      const presign = await request('/api/v1/property/assets/presign', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ filename: `phase7-${index + 1}.png`, mimeType: 'image/png', size: tinyPng.length }),
      })
      expect(presign.response.status).toBe(201)
      const original = presign.body?.data?.original
      expect(original?.uploadUrl).toMatch(/^http/)
      const uploaded = await fetch(original.uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: tinyPng })
      expect(uploaded.ok).toBe(true)
      const complete = await request('/api/v1/property/assets/complete', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ key: original.key, originalName: `phase7-${index + 1}.png`, mimeType: 'image/png', variants: [] }),
      })
      expect(complete.response.status).toBe(202)
      const finalized: any = await WebsiteAssetProcessor.finalize(organizationId, complete.body?.data?._id, { variants: [] })
      expect(finalized?.status).toBe('ready')
      expect(finalized?.scanStatus).toBe('clean')
      uploadedImages.push({ url: finalized.url, publicId: finalized._id.toString(), isFeatured: index === 0, order: index })
    }

    const originalFetch = globalThis.fetch
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
      if (String(input) === 'https://phase7-media.example/import.png') {
        return new Response(tinyPng, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(tinyPng.length) } })
      }
      return originalFetch(input, init)
    })
    const imported = await request('/api/v1/property/assets/import-url', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ url: 'https://phase7-media.example/import.png', altText: 'Imported Phase 7 image' }),
    })
    expect(imported.response.status).toBe(202)
    const importedFinal: any = await WebsiteAssetProcessor.finalize(organizationId, imported.body?.data?._id, { variants: [] })
    expect(importedFinal?.status).toBe('ready')
    expect(importedFinal?.scanStatus).toBe('clean')
    fetchSpy.mockRestore()

    const mediaUpdate = await request(`/api/v1/property/${propertyId}`, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({
        images: uploadedImages,
        mediaLinks: [
          { id: 'youtube-tour', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', type: 'video', title: 'Video walkthrough', isHero: false },
          { id: 'matterport-tour', url: 'https://my.matterport.com/show/?m=abcdEFGHijk', type: 'virtual_tour', title: '3D virtual tour', isHero: true },
        ],
      }),
    })
    expect(mediaUpdate.response.status).toBe(200)
    expect(mediaUpdate.body?.data?.images).toHaveLength(20)
    const hero = mediaUpdate.body?.data?.mediaLinks?.find((item: any) => item.isHero)
    expect(hero?.provider).toBe('matterport')
    expect(hero?.embedUrl).toMatch(/^https:\/\/my\.matterport\.com\/show\//)

    const tooMany = await request(`/api/v1/property/${propertyId}`, {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ images: [...uploadedImages, { ...uploadedImages[0], order: 20, isFeatured: false }] }),
    })
    expect(tooMany.response.status).toBe(400)

    const pages = await request('/api/v1/organization/website/pages', { headers: auth })
    expect(pages.response.status).toBe(200)
    const pageId = pages.body?.data?.[0]?._id
    expect(pageId).toBeTruthy()
    const publishSite = await request(`/api/v1/organization/website/pages/${pageId}/publish`, { method: 'POST', headers: auth, body: '{}' })
    expect(publishSite.response.status).toBe(200)

    const publishProperty = await request(`/api/v1/property/${propertyId}/status`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'Available' }) })
    expect(publishProperty.response.status).toBe(200)
    expect(publishProperty.body?.data?.status).toBe('Available')

    const enquiry = await request('/api/v1/lead/public-capture', {
      method: 'POST',
      body: JSON.stringify({ organizationId, name: 'Interested Buyer', phone: '01812345678', email: 'buyer@example.com', propertyInterest: propertyId, message: 'Please contact me', privacyConsent: true, policyVersion: 'phase7-release', attribution: { utmSource: 'phase7-ci' } }),
    })
    expect(enquiry.response.status).toBe(201)

    const viewing = await request('/api/v1/viewing/public-request', {
      method: 'POST',
      body: JSON.stringify({ organizationId, propertyId, date: tomorrowInDhaka(), startTime: '14:00', endTime: '14:30', clientName: 'Viewing Buyer', clientPhone: '01912345678', clientEmail: 'viewing@example.com', privacyConsent: true, policyVersion: 'phase7-release' }),
    })
    expect(viewing.response.status).toBe(201)
    expect(viewing.body?.data?.agentId).toBeTruthy()

    const changeRequest = await request('/api/v1/billing/change-plan', {
      method: 'POST', headers: auth, body: JSON.stringify({ planId: 'professional', billingCycle: 'monthly' }),
    })
    expect(changeRequest.response.status).toBe(201)
    expect(changeRequest.body?.data?.status).toBe('pending_payment')

    const adminToken = await bearerFor('+8801999999999')
    const adminAuth = { authorization: `Bearer ${adminToken}` }
    const recorded = await request('/api/v1/platform-admin/payments', {
      method: 'POST', headers: adminAuth,
      body: JSON.stringify({ organizationId, changeRequestId: changeRequest.body?.data?._id, method: 'bank', reference: 'PHASE7-BANK-001', notes: 'Phase 7 production verification' }),
    })
    expect(recorded.response.status).toBe(201)
    expect(recorded.body?.data?.status).toBe('pending')
    const paymentNumber = recorded.body?.data?.paymentNumber

    const before = await Organization.findOne({ organizationId }).lean() as any
    expect(before?.subscription?.plan).not.toBe('professional')

    const confirmed = await request(`/api/v1/platform-admin/payments/${paymentNumber}/decision`, {
      method: 'PATCH', headers: adminAuth,
      body: JSON.stringify({ status: 'confirmed', reason: 'Manual payment verified' }),
    })
    expect(confirmed.response.status).toBe(200)
    expect(confirmed.body?.data?.receiptNumber).toMatch(/^RCT-/)

    const activated = await Organization.findOne({ organizationId }).lean() as any
    expect(activated?.subscription?.plan).toBe('professional')
    expect(activated?.subscription?.status).toBe('active')
    expect(activated?.subscription?.source).toBe('manual_payment')

    const receipt = await request(`/api/v1/billing/history/${paymentNumber}/receipt`, { headers: auth })
    expect(receipt.response.status).toBe(200)
    expect(receipt.response.headers.get('content-type')).toContain('application/pdf')
    expect(receipt.response.headers.get('content-disposition')).toMatch(/attachment; filename="opygen-estate-RCT-[^"]+\.pdf"/)
    expect(Buffer.from(receipt.bytes).subarray(0, 5).toString('ascii')).toBe('%PDF-')

    const revenue = await request('/api/v1/platform-admin/revenue', { headers: adminAuth })
    expect(revenue.response.status).toBe(200)
    expect(revenue.body?.data?.totalRevenue).toBeGreaterThanOrEqual(1500)
    expect(revenue.body?.data?.activeSubscriptions).toBeGreaterThanOrEqual(1)
  }, 120_000)
})
