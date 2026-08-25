import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const providerState = vi.hoisted(() => ({ providerVerified: false, tlsActive: false, publicActive: false }))
const dnsState = vi.hoisted(() => ({ values: ['realestate-saas=phase9-domain-token'] }))

vi.mock('dns/promises', () => ({
  default: {
    resolveTxt: vi.fn(async () => [dnsState.values]),
  },
}))

vi.mock('../../app/module/domain/providers', () => {
  const diagnostic = (check: string, label: string, ok: boolean) => ({
    check, label, ok, state: ok ? 'pass' : 'pending', expected: 'expected', observed: ok ? 'expected' : 'pending', checkedAt: new Date(),
  })
  const provider = {
    name: 'vercel',
    getRequiredDns: vi.fn(async ({ domain, ownershipToken }: any) => [
      { type: 'TXT', name: `_realestate-verification.${domain}`, host: '_realestate-verification', value: `realestate-saas=${ownershipToken}`, purpose: 'ownership' },
      { type: 'A', name: domain, host: '@', value: '76.76.21.21', purpose: 'routing' },
      { type: 'CNAME', name: `www.${domain}`, host: 'www', value: 'cname.vercel-dns.com', purpose: 'routing' },
      { type: 'TXT', name: `_vercel.${domain}`, host: '_vercel', value: 'vc-domain-verify=phase9-provider', purpose: 'provider_verification' },
    ]),
    registerDomain: vi.fn(async () => ({ registered: true, providerRequestId: 'project-domain-1' })),
    verifyRouting: vi.fn(async () => ({
      apexOk: true,
      wwwOk: true,
      registered: true,
      providerVerified: providerState.providerVerified,
      diagnostics: [
        diagnostic('apex_a', 'A / apex routing', true),
        diagnostic('www_cname', 'www routing', true),
        diagnostic('hosting_registration', 'Hosting registration', providerState.providerVerified),
      ],
    })),
    provisionTls: vi.fn(async () => ({
      status: providerState.tlsActive ? 'active' : 'provisioning',
      diagnostics: [diagnostic('tls_certificate', 'TLS certificate', providerState.tlsActive)],
    })),
    getTlsStatus: vi.fn(async () => ({ status: providerState.tlsActive ? 'active' : 'provisioning', diagnostics: [] })),
    verifyPublicRouting: vi.fn(async () => ({
      active: providerState.publicActive,
      diagnostics: [diagnostic('public_routing', 'Public routing', providerState.publicActive)],
    })),
    removeDomain: vi.fn(async () => undefined),
    hasDomain: vi.fn(async () => false),
    health: vi.fn(async () => ({ provider: 'vercel', configured: true, healthy: true, latencyMs: 3, checkedAt: new Date().toISOString() })),
  }
  return { DomainProviderService: { current: () => provider, health: provider.health } }
})

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip
let server: Server
let baseUrl = ''
let mongoose: typeof import('mongoose')
let User: any
let Organization: any
let DomainRecord: any
let jwtHelpers: any
let config: any

const request = async (path: string, headers: Record<string, string> = {}, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...headers, ...(init.headers || {}) },
  })
  const text = await response.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { response, body }
}

suite('Phase 9 custom-domain lifecycle integration', () => {
  const organizationId = 'org_phase9_domain'
  const otherOrganizationId = 'org_phase9_other'
  const domain = 'phase9-domain.example'
  const otherDomain = 'other-phase9-domain.example'
  const replacementDomain = 'replacement-phase9-domain.example'
  let auth: Record<string, string>

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
    await mongoose.connect(requiredDb!, { autoIndex: true, serverSelectionTimeoutMS: 5000 })
    await mongoose.connection.dropDatabase()
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ DomainRecord } = await import('../../app/module/domain/domain.model'))
    ;({ jwtHelpers } = await import('../../app/helpers/jwtHelpers'))
    config = (await import('../../config')).default

    await Organization.create({
      organizationId,
      agencyName: 'Phase Nine Domain Realty',
      email: 'domain-owner@example.com',
      phone: '+8801711111111',
      sub_domain: 'phase9-domain',
      subscription: { plan: 'professional', status: 'active', maxProperties: 100, maxAgents: 10 },
    })
    const user = await User.create({
      name: 'Domain Owner',
      email: 'domain-owner@example.com',
      phoneNumber: '+8801711111111',
      password: 'Production123!',
      organizationId,
      userRole: 'agency_owner',
      status: 'active',
      isVerified: true,
    })
    const token = jwtHelpers.createToken({
      _id: user._id.toString(), phoneNumber: user.phoneNumber, email: user.email,
      userRole: user.userRole, organizationId,
    }, config.jwt.secret, config.jwt.expires_in)
    auth = { authorization: `Bearer ${token}` }

    await DomainRecord.create({
      organizationId,
      domain,
      ownershipToken: 'phase9-domain-token',
      lifecycleStatus: 'PENDING_DNS',
      status: 'pending',
      tlsStatus: 'not_started',
      providerRegistrationStatus: 'registered',
      requiredDns: [],
      nextCheckAt: new Date(),
    })
    await Organization.create({
      organizationId: otherOrganizationId,
      agencyName: 'Other Phase Nine Realty',
      email: 'other-domain-owner@example.com',
      phone: '+8801722222222',
      sub_domain: 'phase9-other',
      subscription: { plan: 'professional', status: 'active', maxProperties: 100, maxAgents: 10 },
    })
    await DomainRecord.create({
      organizationId: otherOrganizationId,
      domain: otherDomain,
      ownershipToken: 'other-phase9-token',
      lifecycleStatus: 'ACTIVE',
      publicRoutingStatus: 'active',
      status: 'verified',
      tlsStatus: 'active',
      providerRegistrationStatus: 'registered',
      requiredDns: [],
      nextCheckAt: new Date(Date.now() + 60_000),
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

  it('stops after Opygen ownership while Vercel project verification is still pending', async () => {
    providerState.providerVerified = false
    const pendingProvider = await request('/api/v1/domain/verify', auth, { method: 'POST', body: '{}' })
    expect(pendingProvider.response.status).toBe(200)
    expect(pendingProvider.body?.data?.lifecycleStatus).toBe('OWNERSHIP_VERIFIED')
    expect(pendingProvider.body?.data?.tlsStatus).toBe('not_started')
    expect(pendingProvider.body?.data?.requiredDns).toEqual(expect.arrayContaining([
      expect.objectContaining({ purpose: 'provider_verification', host: '_vercel' }),
    ]))
  })

  it('does not route after DNS/routing verification while TLS is still provisioning', async () => {
    providerState.providerVerified = true
    const verified = await request('/api/v1/domain/verify', auth, { method: 'POST', body: '{}' })
    expect(verified.response.status).toBe(200)
    expect(verified.body?.data?.lifecycleStatus).toBe('TLS_PROVISIONING')
    expect(verified.body?.data?.tlsStatus).toBe('provisioning')
    expect(verified.body?.data?.diagnostics?.map((item: any) => item.check)).toEqual(expect.arrayContaining([
      'ownership_txt', 'apex_a', 'www_cname', 'hosting_registration', 'tls_certificate', 'public_routing',
    ]))

    const beforeTls = await request(`/api/v1/domain/resolve/${domain}`)
    expect(beforeTls.response.status).toBe(200)
    expect(beforeTls.body?.data).toBeNull()
  })

  it('routes only after TLS and the public Vercel runtime check are active', async () => {
    providerState.tlsActive = true
    providerState.publicActive = true
    const active = await request('/api/v1/domain/verify', auth, { method: 'POST', body: '{}' })
    expect(active.response.status).toBe(200)
    expect(active.body?.data?.lifecycleStatus).toBe('ACTIVE')
    expect(active.body?.data?.publicRoutingStatus).toBe('active')

    const apex = await request(`/api/v1/domain/resolve/${domain}`)
    expect(apex.body?.data?.organizationId).toBe(organizationId)
    expect(apex.body?.data?.redirectTo).toBeNull()

    const www = await request(`/api/v1/domain/resolve/www.${domain}`)
    expect(www.body?.data?.organizationId).toBe(organizationId)
    expect(www.body?.data?.redirectTo).toBe(`https://${domain}`)

    const freeSubdomain = await request('/api/v1/domain/resolve-subdomain/phase9-domain')
    expect(freeSubdomain.body?.data?.organizationId).toBe(organizationId)
  })

  it('stages a replacement without downtime, promotes atomically, and keeps the retired host as a 308 target during grace', async () => {
    const staged = await request('/api/v1/domain/add', auth, { method: 'POST', body: JSON.stringify({ domain: replacementDomain }) })
    expect(staged.response.status).toBe(200)
    expect(staged.body?.data?.domain).toBe(domain)
    expect(staged.body?.data?.candidate?.domain).toBe(replacementDomain)
    expect(staged.body?.data?.replacementInProgress).toBe(true)
    expect(staged.body?.data?.candidate).not.toHaveProperty('ownershipToken')

    const candidateRecord = await DomainRecord.findOne({ organizationId }).lean()
    const candidateToken = candidateRecord?.candidate?.ownershipToken
    expect(candidateToken).toBeTruthy()

    // Candidate ownership is not configured yet. The currently ACTIVE host must stay online.
    dnsState.values = ['realestate-saas=phase9-domain-token']
    const pending = await request('/api/v1/domain/verify', auth, { method: 'POST', body: '{}' })
    expect(pending.body?.data?.domain).toBe(domain)
    expect(pending.body?.data?.candidate?.lifecycleStatus).toBe('PENDING_DNS')
    const stillLive = await request(`/api/v1/domain/resolve/${domain}`)
    expect(stillLive.body?.data?.organizationId).toBe(organizationId)
    expect(stillLive.body?.data?.redirectTo).toBeNull()

    // Once the candidate passes ownership, routing, TLS and public-runtime checks, it is promoted.
    dnsState.values = [`realestate-saas=${candidateToken}`]
    const promoted = await request('/api/v1/domain/verify', auth, { method: 'POST', body: '{}' })
    expect(promoted.body?.data?.domain).toBe(replacementDomain)
    expect(promoted.body?.data?.candidate).toBeNull()
    expect(promoted.body?.data?.lifecycleStatus).toBe('ACTIVE')
    expect(promoted.body?.data?.retiredDomains).toEqual(expect.arrayContaining([expect.objectContaining({ domain })]))

    const canonical = await request(`/api/v1/domain/resolve/${replacementDomain}`)
    expect(canonical.body?.data?.organizationId).toBe(organizationId)
    expect(canonical.body?.data?.redirectTo).toBeNull()

    const retiredApex = await request(`/api/v1/domain/resolve/${domain}`)
    expect(retiredApex.body?.data?.organizationId).toBe(organizationId)
    expect(retiredApex.body?.data?.redirectTo).toBe(`https://${replacementDomain}`)

    const retiredWww = await request(`/api/v1/domain/resolve/www.${domain}`)
    expect(retiredWww.body?.data?.redirectTo).toBe(`https://${replacementDomain}`)

    const org = await Organization.findOne({ organizationId }).lean()
    expect(org?.domain).toBe(replacementDomain)
    expect(org?.domain_Verify).toBe(true)
  })

  it('keeps subdomain aliases routable and removes expired retired-domain redirects on the lifecycle worker path', async () => {
    const { SubdomainAlias } = await import('../../app/module/domain/subdomainAlias.model')
    await SubdomainAlias.create({ alias: 'phase9-legacy', organizationId, canonicalSubdomain: 'phase9-domain' })
    const alias = await request('/api/v1/domain/resolve-subdomain/phase9-legacy')
    expect(alias.body?.data?.organizationId).toBe(organizationId)
    expect(alias.body?.data?.isAlias).toBe(true)

    await DomainRecord.updateOne(
      { organizationId, 'retiredDomains.domain': domain },
      { $set: { 'retiredDomains.$.retireAfter': new Date(Date.now() - 1000), nextCheckAt: new Date() } },
    )
    const cleanup = await request('/api/v1/domain/verify', auth, { method: 'POST', body: '{}' })
    expect(cleanup.response.status).toBe(200)
    const oldHost = await request(`/api/v1/domain/resolve/${domain}`)
    expect(oldHost.body?.data).toBeNull()
  })

  it('keeps custom hosts tenant-exact and exposes worker/provider queue health', async () => {
    const other = await request(`/api/v1/domain/resolve/${otherDomain}`)
    expect(other.body?.data?.organizationId).toBe(otherOrganizationId)
    expect(other.body?.data?.organizationId).not.toBe(organizationId)

    const health = await request('/api/v1/domain/health', auth)
    expect(health.response.status).toBe(200)
    expect(health.body?.data?.provider?.healthy).toBe(true)
    expect(health.body?.data?.worker).toHaveProperty('healthy')
    expect(health.body?.data?.queue).toEqual(expect.objectContaining({ pending: expect.any(Number), processing: expect.any(Number), failed: expect.any(Number) }))
  })

  it('fails closed for unknown hosts, preserves entitlement downgrade/reactivation, and reports tenant suspension', async () => {
    const wrong = await request('/api/v1/domain/resolve/old-phase9-domain.example')
    expect(wrong.body?.data).toBeNull()

    await DomainRecord.updateOne({ organizationId }, { $set: { entitlementStatus: 'suspended' } })
    const planSuspended = await request(`/api/v1/domain/resolve/${replacementDomain}`)
    expect(planSuspended.body?.data).toBeNull()
    await DomainRecord.updateOne({ organizationId }, { $set: { entitlementStatus: 'active' } })
    const reactivated = await request(`/api/v1/domain/resolve/${replacementDomain}`)
    expect(reactivated.body?.data?.organizationId).toBe(organizationId)

    await Organization.updateOne({ organizationId }, { $set: { isBlocked: true } })
    const suspended = await request(`/api/v1/domain/resolve/${replacementDomain}`)
    expect(suspended.body?.data?.organizationId).toBe(organizationId)
    expect(suspended.body?.data?.websiteStatus).toBe('suspended')
  })
})
