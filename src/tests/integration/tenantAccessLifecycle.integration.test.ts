import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip

suite('Tenant access Phase 5 lifecycle matrix', () => {
  const runId = `${process.pid}-${Date.now()}`
  const organizationId = `tenant-access-phase5-${runId}`
  const subdomain = `ta5-${runId}`.slice(0, 60)
  const customDomain = `ta5-${runId}.example.test`
  const probeId = `tenant-access-preserve-${runId}`

  let server: Server
  let baseUrl = ''
  let mongoose: typeof import('mongoose')
  let Organization: any
  let User: any
  let Property: any
  let DomainRecord: any
  let TenantAccessService: any
  let TenantAccessTransitionService: any
  let PlatformAdminService: any
  let jwtHelpers: any
  let config: any
  let owner: any
  let property: any
  const preservationRefs: Array<{ collection: string; id: any }> = []

  const jsonRequest = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { accept: 'application/json', ...(init.headers || {}) },
    })
    const text = await response.text()
    let body: any = null
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    return { response, body }
  }

  const bearer = () => jwtHelpers.createToken({
    _id: String(owner._id),
    phoneNumber: owner.phoneNumber,
    email: owner.email,
    userRole: owner.userRole,
    organizationId,
  }, config.jwt.secret, config.jwt.expires_in)

  const assertPreserved = async () => {
    const db = mongoose.connection.db
    if (!db) throw new Error('MongoDB connection unavailable')
    for (const ref of preservationRefs) {
      expect(await db.collection(ref.collection).findOne({ _id: ref.id }), `${ref.collection} preservation probe`).toBeTruthy()
    }
    expect(await Organization.exists({ organizationId })).toBeTruthy()
    expect(await User.exists({ _id: owner._id, organizationId })).toBeTruthy()
    expect(await Property.exists({ _id: property._id, organizationId })).toBeTruthy()
    expect(await DomainRecord.exists({ organizationId, domain: customDomain })).toBeTruthy()
  }

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
    if (mongoose.connection.readyState === 0) await mongoose.connect(requiredDb!, { autoIndex: true, serverSelectionTimeoutMS: 5000 })

    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ Property } = await import('../../app/module/property/property.model'))
    ;({ DomainRecord } = await import('../../app/module/domain/domain.model'))
    ;({ TenantAccessService } = await import('../../app/module/tenantAccess/tenantAccess.service'))
    ;({ TenantAccessTransitionService } = await import('../../app/module/tenantAccess/tenantAccessTransition.service'))
    ;({ PlatformAdminService } = await import('../../app/module/platformAdmin/platformAdmin.service'))
    ;({ jwtHelpers } = await import('../../app/helpers/jwtHelpers'))
    config = (await import('../../config')).default

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const org: any = await Organization.create({
      organizationId,
      agencyName: 'Tenant Access Phase 5',
      email: `tenant-access-${runId}@example.test`,
      phone: '+8801712345678',
      sub_domain: subdomain,
      websiteStatus: 'published',
      isBlocked: false,
      platformAccess: { status: 'active' },
      subscription: {
        plan: 'trial',
        planVersion: 1,
        status: 'trialing',
        currentPeriodStart: new Date(),
        currentPeriodEnd: future,
        trialEndsAt: future,
        gracePeriodEnd: null,
        revision: 0,
        maxProperties: 20,
        maxAgents: 5,
      },
    })

    owner = await User.create({
      name: 'Tenant Access Owner',
      email: `tenant-access-owner-${runId}@example.test`,
      phoneNumber: '+8801712345679',
      organizationId,
      userRole: 'agency_owner',
      status: 'active',
      isVerified: true,
    })
    await Organization.updateOne({ organizationId }, { $set: { ownerId: owner._id } })

    property = await Property.create({
      organizationId,
      slug: `tenant-access-property-${runId}`,
      title: 'Tenant Access Property',
      propertyType: 'Apartment',
      listingType: 'ForSale',
      status: 'Available',
      price: 9500000,
      currency: 'BDT',
      country: 'Bangladesh',
      city: 'Dhaka',
    })

    await DomainRecord.create({
      organizationId,
      domain: customDomain,
      ownershipToken: `ownership-${runId}`,
      entitlementStatus: 'active',
      lifecycleStatus: 'ACTIVE',
      providerRegistrationStatus: 'registered',
      publicRoutingStatus: 'active',
      status: 'verified',
      tlsStatus: 'active',
      activeAt: new Date(),
      verifiedAt: new Date(),
    })

    const db = mongoose.connection.db
    if (!db) throw new Error('MongoDB connection unavailable')
    const probeRows: Array<[string, Record<string, unknown>]> = [
      ['leads', { name: 'Preserved Lead', phone: '+8801711111101' }],
      ['contacts', { name: 'Preserved Contact', phone: '+8801711111102' }],
      ['tasks', { title: 'Preserved Task' }],
      ['viewings', { clientName: 'Preserved Viewing' }],
      ['financeinvoices', { invoiceNumber: `TA5-INV-${runId}` }],
      ['websitepages', { slug: `ta5-preserved-${runId}`, status: 'draft' }],
      ['websiterevisions', { pageId: new mongoose.Types.ObjectId(), version: 1 }],
      ['websiteassets', { key: `tenant-access/${runId}/asset.webp` }],
      ['metaintegrations', { enabled: false }],
      ['visitorlogs', { path: '/phase5-preserved' }],
      ['auditevents', { action: 'phase5.preservation_probe' }],
      ['subscriptionpayments', { paymentNumber: `TA5-PAY-${runId}`, receiptNumber: `TA5-RCT-${runId}`, planId: 'professional', planVersion: 4, billingCycle: 'monthly', amount: 1000, currency: 'BDT', method: 'cash' }],
      ['subscriptionbenefitperiods', { paymentSource: 'manual_admin', paymentNumber: `TA5-BEN-${runId}`, planId: 'professional', planVersion: 4, billingCycle: 'monthly', periodStart: new Date(), periodEnd: future, renewalStreak: 1, baseLeadAllowance: 1, bonusLeadAllowance: 0, totalLeadAllowance: 1, usedLeadAllowance: 0, renewalBonusEnabled: false, renewalLeadBonus: 0, maxRenewalLeadBonus: 0, continuityGraceDays: 0 }],
    ]
    for (const [collection, extra] of probeRows) {
      const result = await db.collection(collection).insertOne({ organizationId, phase5PreservationProbe: probeId, createdAt: new Date(), ...extra })
      preservationRefs.push({ collection, id: result.insertedId })
    }
    const app = (await import('../../app')).default
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind Tenant Access Phase 5 integration server')
        baseUrl = `http://127.0.0.1:${address.port}`
        resolve()
      })
    })
  }, 30_000)

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    const db = mongoose?.connection?.db
    if (db) {
      for (const ref of preservationRefs) await db.collection(ref.collection).deleteOne({ _id: ref.id }).catch(() => undefined)
    }
    await Promise.all([
      DomainRecord?.deleteMany({ organizationId }),
      Property?.deleteMany({ organizationId }),
      User?.deleteMany({ organizationId }),
      Organization?.deleteMany({ organizationId }),
    ]).catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('enforces expiry everywhere, preserves data/domains, restores on renewal, and keeps platform suspension authoritative', async () => {
    const token = bearer()

    // Trial before expiry: workspace and published public website are available.
    let access = await TenantAccessService.evaluate(organizationId)
    expect(access.workspaceAllowed).toBe(true)
    expect(access.publicWebsiteAllowed).toBe(true)
    expect((await jsonRequest('/api/v1/property', { headers: { authorization: `Bearer ${token}` } })).response.status).toBe(200)
    expect((await jsonRequest(`/api/v1/property/public/${organizationId}`)).response.status).toBe(200)

    // Exact trial boundary: request-time reconciliation persists expired, then
    // workspace/public reads/public writes/SEO all fail closed immediately.
    const expiredAt = new Date(Date.now() - 1000)
    await Organization.updateOne({ organizationId }, { $set: {
      'subscription.plan': 'trial',
      'subscription.planVersion': 1,
      'subscription.status': 'trialing',
      'subscription.currentPeriodEnd': expiredAt,
      'subscription.trialEndsAt': expiredAt,
      'subscription.gracePeriodEnd': null,
    } })

    const lockedWorkspace = await jsonRequest('/api/v1/property', { headers: { authorization: `Bearer ${token}` } })
    expect(lockedWorkspace.response.status).toBe(402)
    expect(lockedWorkspace.body?.code).toBe('SUBSCRIPTION_INACTIVE')
    expect(['TRIAL_ENDED', 'TRIAL_EXPIRED']).toContain(lockedWorkspace.body?.details?.reason)

    const expiredOrg: any = await Organization.findOne({ organizationId }).lean()
    expect(['grace', 'expired']).toContain(expiredOrg.subscription.status)

    for (const path of [
      `/api/v1/property/public/${organizationId}`,
      `/api/v1/users/public/${organizationId}`,
      `/api/v1/organization/website/public-site/${subdomain}/sitemap.xml`,
      `/api/v1/organization/website/public-site/${subdomain}/robots.txt`,
      `/api/v1/organization/website/public-site/${subdomain}/share-card/${property._id}`,
    ]) {
      const locked = await jsonRequest(path)
      expect(locked.response.status).toBe(503)
      expect(locked.response.headers.get('cache-control')).toContain('no-store')
      expect(locked.response.headers.get('x-robots-tag')).toContain('noindex')
    }

    const leadWrite = await jsonRequest('/api/v1/lead/public-capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId, submissionContext: 'CONTACT', name: 'Locked Lead', phone: '+8801711111191', email: `locked-lead-${runId}@example.test`, message: 'Locked', privacyConsent: true, policyVersion: 'phase5-test-v1' }),
    })
    expect(leadWrite.response.status).toBe(503)

    const appointmentDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const viewingWrite = await jsonRequest('/api/v1/viewing/public-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId, propertyId: String(property._id), date: appointmentDate, startTime: '14:00', endTime: '15:00', clientName: 'Locked Viewing', clientPhone: '+8801711111192', clientEmail: `locked-viewing-${runId}@example.test`, privacyConsent: true, policyVersion: 'phase5-test-v1' }),
    })
    expect(viewingWrite.response.status).toBe(503)

    const lockedSubdomain = await jsonRequest(`/api/v1/domain/resolve-subdomain/${subdomain}`)
    expect(lockedSubdomain.response.status).toBe(200)
    expect(lockedSubdomain.body?.data?.publicAccess?.allowed).toBe(false)
    const lockedCustomDomain = await jsonRequest(`/api/v1/domain/resolve/${customDomain}`)
    expect(lockedCustomDomain.response.status).toBe(200)
    expect(lockedCustomDomain.body?.data?.publicAccess?.allowed).toBe(false)
    expect(await DomainRecord.exists({ organizationId, domain: customDomain })).toBeTruthy()
    await assertPreserved()

    // Confirmed-renewal state: the canonical transition immediately restores
    // workspace/public access and the same already-provisioned domain.
    const paidEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const beforeRenewal: any = await Organization.findOne({ organizationId }).lean()
    await Organization.updateOne({ organizationId }, { $set: {
      'subscription.plan': 'professional',
      'subscription.planVersion': 4,
      'subscription.status': 'active',
      'subscription.currentPeriodStart': new Date(),
      'subscription.currentPeriodEnd': paidEnd,
      'subscription.trialEndsAt': null,
      'subscription.gracePeriodEnd': null,
      'subscription.source': 'manual_payment',
    } })
    await TenantAccessTransitionService.sync({ organizationId, source: 'phase5_integration_renewal', eventType: 'subscription.payment_confirmed', previousSubscriptionStatus: beforeRenewal.subscription.status })

    access = await TenantAccessService.evaluate(organizationId)
    expect(access.workspaceAllowed).toBe(true)
    expect(access.publicWebsiteAllowed).toBe(true)
    expect((await jsonRequest('/api/v1/property', { headers: { authorization: `Bearer ${token}` } })).response.status).toBe(200)
    expect((await jsonRequest(`/api/v1/property/public/${organizationId}`)).response.status).toBe(200)
    expect((await jsonRequest(`/api/v1/domain/resolve/${customDomain}`)).body?.data?.publicAccess?.allowed).toBe(true)
    await assertPreserved()

    // Paid plan after its period end without renewal follows the same lock path.
    await Organization.updateOne({ organizationId }, { $set: {
      'subscription.status': 'active',
      'subscription.currentPeriodEnd': new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
      'subscription.gracePeriodEnd': null,
    } })
    access = await TenantAccessService.evaluate(organizationId)
    expect(access.workspaceAllowed).toBe(false)
    expect(access.publicWebsiteAllowed).toBe(false)
    expect(access.reason).toBe('SUBSCRIPTION_EXPIRED')
    expect((await jsonRequest('/api/v1/property', { headers: { authorization: `Bearer ${token}` } })).response.status).toBe(402)

    // Renew while platform-suspended: billing becomes active, but platform state
    // remains the higher-precedence lock until Super Admin explicitly reactivates.
    await Organization.updateOne({ organizationId }, { $set: {
      'subscription.status': 'active',
      'subscription.currentPeriodEnd': paidEnd,
    } })
    const beforeSuspend: any = await Organization.findOne({ organizationId }).lean()
    await PlatformAdminService.suspendTenant(organizationId, { id: 'phase5-super-admin', reason: 'Phase 5 precedence test' })
    let suspended: any = await Organization.findOne({ organizationId }).lean()
    expect(suspended.subscription.status).toBe('active')
    expect(suspended.websiteStatus).toBe(beforeSuspend.websiteStatus)

    await Organization.updateOne({ organizationId }, { $set: { 'subscription.status': 'expired' } })
    await Organization.updateOne({ organizationId }, { $set: { 'subscription.status': 'active', 'subscription.currentPeriodEnd': paidEnd } })
    await TenantAccessTransitionService.sync({ organizationId, source: 'phase5_suspended_renewal', eventType: 'subscription.payment_confirmed', previousSubscriptionStatus: 'expired' })
    access = await TenantAccessService.evaluate(organizationId)
    expect(access.subscriptionStatus).toBe('active')
    expect(access.platformStatus).toBe('suspended')
    expect(access.workspaceAllowed).toBe(false)
    expect(access.publicWebsiteAllowed).toBe(false)
    expect(access.reason).toBe('PLATFORM_SUSPENDED')

    await PlatformAdminService.reactivateTenant(organizationId, { id: 'phase5-super-admin', reason: 'Phase 5 precedence test complete' })
    access = await TenantAccessService.evaluate(organizationId)
    expect(access.subscriptionStatus).toBe('active')
    expect(access.platformStatus).toBe('active')
    expect(access.workspaceAllowed).toBe(true)
    expect(access.publicWebsiteAllowed).toBe(true)

    // Renewal never publishes a website that was only provisioned.
    await Organization.updateOne({ organizationId }, { $set: {
      websiteStatus: 'provisioned',
      'subscription.status': 'expired',
    } })
    await Organization.updateOne({ organizationId }, { $set: {
      'subscription.status': 'active',
      'subscription.currentPeriodEnd': paidEnd,
    } })
    await TenantAccessTransitionService.sync({ organizationId, source: 'phase5_unpublished_renewal', eventType: 'subscription.payment_confirmed', previousSubscriptionStatus: 'expired' })
    const provisioned: any = await Organization.findOne({ organizationId }).lean()
    access = await TenantAccessService.evaluate(organizationId)
    expect(provisioned.websiteStatus).toBe('provisioned')
    expect(access.workspaceAllowed).toBe(true)
    expect(access.publicWebsiteAllowed).toBe(false)
    expect(access.reason).toBe('WEBSITE_NOT_PUBLISHED')
    await assertPreserved()
  }, 45_000)
})
