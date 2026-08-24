import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip

suite('Phase 5 production regression matrix', () => {
  const runId = `${process.pid}-${Date.now()}`
  const organizationId = `phase5-${runId}`
  const expiredOrganizationId = `phase5-expired-${runId}`

  let server: Server
  let baseUrl = ''
  let mongoose: typeof import('mongoose')
  let Organization: any
  let User: any
  let Property: any
  let Lead: any
  let Viewing: any
  let DomainEvent: any
  let Activity: any
  let WebsiteSubmission: any
  let TeamInvitation: any
  let LeadService: any
  let ViewingService: any
  let WebsiteSubmissionService: any
  let EntitlementService: any
  let readLeadListPage: any
  let mongoSupportsTransactions: any
  let resetMongoCapabilitiesCacheForTests: any
  let LEAD_STATUS: any
  let jwtHelpers: any
  let config: any
  let logger: any
  let owner: any
  let agent: any
  let property: any
  let lead: any

  const managerAccess = () => ({
    userId: String(owner._id),
    role: 'agency_owner',
    permissions: ['leads.read', 'leads.write', 'leads.assign', 'viewings.read', 'viewings.write', 'crm.team.read', 'crm.team.manage'],
    isManager: true,
    canReadTeam: true,
    canManageTeam: true,
    scope: 'team' as const,
  })

  const futureSlot = (offsetDays = 7) => {
    const now = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
    return { date, startTime: '14:00', endTime: '15:00' }
  }

  const request = async (path: string, token: string) => {
    const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
    const text = await response.text()
    let body: any = null
    try { body = text ? JSON.parse(text) : null } catch { body = null }
    return { response, body }
  }

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
    if (mongoose.connection.readyState === 0) await mongoose.connect(requiredDb!, { autoIndex: true, serverSelectionTimeoutMS: 5000 })

    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ Property } = await import('../../app/module/property/property.model'))
    ;({ Lead } = await import('../../app/module/lead/lead.model'))
    ;({ Viewing } = await import('../../app/module/viewing/viewing.model'))
    ;({ DomainEvent } = await import('../../app/module/domainEvent/domainEvent.model'))
    ;({ Activity } = await import('../../app/module/activity/activity.model'))
    ;({ WebsiteSubmission } = await import('../../app/module/websiteSubmission/websiteSubmission.model'))
    ;({ TeamInvitation } = await import('../../app/module/teamInvitation/teamInvitation.model'))
    ;({ LeadService } = await import('../../app/module/lead/lead.service'))
    ;({ ViewingService } = await import('../../app/module/viewing/viewing.service'))
    ;({ WebsiteSubmissionService } = await import('../../app/module/websiteSubmission/websiteSubmission.service'))
    ;({ EntitlementService } = await import('../../app/module/entitlement/entitlement.service'))
    ;({ readLeadListPage } = await import('../../app/module/crm/crmListReadModel.service'))
    ;({ mongoSupportsTransactions, resetMongoCapabilitiesCacheForTests } = await import('../../app/db/mongoCapabilities'))
    ;({ LEAD_STATUS } = await import('../../app/module/lead/leadStatus.contract'))
    ;({ jwtHelpers } = await import('../../app/helpers/jwtHelpers'))
    config = (await import('../../config')).default
    ;({ logger } = await import('../../shared/logger'))

    await Organization.create([
      {
        organizationId,
        agencyName: 'Phase 5 Production Regression',
        email: `phase5-${runId}@example.test`,
        phone: '+8801711111111',
        sub_domain: `phase5-${runId}`.slice(0, 60),
        websiteStatus: 'published',
        subscription: { plan: 'trial', status: 'trialing', maxProperties: 20, maxAgents: 3, currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
      },
      {
        organizationId: expiredOrganizationId,
        agencyName: 'Phase 5 Expired Regression',
        email: `phase5-expired-${runId}@example.test`,
        phone: '+8801722222222',
        sub_domain: `phase5-expired-${runId}`.slice(0, 60),
        subscription: { plan: 'trial', status: 'expired', maxProperties: 20, maxAgents: 2, currentPeriodEnd: new Date(Date.now() - 60_000), trialEndsAt: new Date(Date.now() - 60_000) },
      },
    ])

    owner = await User.create({
      name: 'Phase 5 Owner', email: `phase5-owner-${runId}@example.test`, phoneNumber: '+8801733333333', organizationId,
      userRole: 'agency_owner', status: 'active', isVerified: true,
    })
    agent = await User.create({
      name: 'Phase 5 Agent', email: `phase5-agent-${runId}@example.test`, phoneNumber: '+8801744444444', organizationId,
      userRole: 'agent', status: 'active', isVerified: true,
    })
    await Organization.updateOne({ organizationId }, { $set: { ownerId: owner._id } })

    property = await Property.create({
      organizationId,
      slug: `phase5-property-${runId}`,
      title: 'Phase 5 Property',
      propertyType: 'Apartment',
      listingType: 'ForSale',
      status: 'Available',
      price: 9000000,
      currency: 'BDT',
      country: 'Bangladesh',
      city: 'Dhaka',
      agentId: agent._id,
    })

    lead = await Lead.create({
      organizationId,
      name: 'Phase 5 Viewing Lead',
      phone: '+8801755555555',
      normalizedPhone: '+8801755555555',
      email: `phase5-viewing-${runId}@example.test`,
      normalizedEmail: `phase5-viewing-${runId}@example.test`,
      source: 'Website',
      leadStatus: LEAD_STATUS.VIEWING_SCHEDULED,
      assignedAgent: agent._id,
      propertyInterest: [property._id],
      currency: 'BDT',
    })

    resetMongoCapabilitiesCacheForTests()
    expect(await mongoSupportsTransactions()).toBe(true)

    const app = (await import('../../app')).default
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind Phase 5 integration server')
        baseUrl = `http://127.0.0.1:${address.port}`
        resolve()
      })
    })
  }, 30_000)

  afterAll(async () => {
    vi.restoreAllMocks()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    const orgFilter = { organizationId: { $in: [organizationId, expiredOrganizationId] } }
    await Promise.all([
      Activity.deleteMany(orgFilter),
      DomainEvent.deleteMany(orgFilter),
      Viewing.deleteMany(orgFilter),
      WebsiteSubmission.deleteMany(orgFilter),
      Lead.deleteMany(orgFilter),
      Property.deleteMany(orgFilter),
      TeamInvitation.deleteMany(orgFilter),
      User.deleteMany(orgFilter),
      Organization.deleteMany({ organizationId: { $in: [organizationId, expiredOrganizationId] } }),
    ]).catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('updates a viewing schedule and completes it with canonical leadId, activity projection, and Lead lifecycle in one transactional path', async () => {
    const initial = await Viewing.create({
      organizationId,
      propertyId: property._id,
      leadId: lead._id,
      agentId: agent._id,
      ...futureSlot(5),
      status: 'Scheduled',
      clientName: 'Phase 5 Buyer',
      clientPhone: '+8801766666666',
      clientEmail: `phase5-buyer-${runId}@example.test`,
    })

    const moved = await ViewingService.updateViewing(organizationId, String(initial._id), futureSlot(6), String(owner._id), managerAccess())
    expect(moved.status).toBe('Scheduled')

    const completed = await ViewingService.updateViewing(organizationId, String(initial._id), { status: 'Completed' }, String(owner._id), managerAccess())
    expect(completed.status).toBe('Completed')

    const persistedLead = await Lead.findById(lead._id).lean()
    expect(persistedLead?.leadStatus).toBe(LEAD_STATUS.VIEWING_COMPLETED)

    const event: any = await DomainEvent.findOne({ organizationId, aggregateId: String(initial._id), eventType: 'viewing.completed' }).lean()
    expect(event).toBeTruthy()
    expect(String(event.leadId)).toBe(String(lead._id))
    expect(event.leadId).toBeInstanceOf(mongoose.Types.ObjectId)

    const activity = await Activity.findOne({ organizationId, 'metadata.domainEventId': event._id }).lean()
    expect(activity).toMatchObject({ type: 'viewing', title: 'Viewing completed' })
  })

  it('edits Lead status, assignee, and follow-up through one atomic management operation', async () => {
    const managedLead = await Lead.create({
      organizationId,
      name: 'Phase 5 Managed Lead',
      phone: '+8801777777777',
      normalizedPhone: '+8801777777777',
      source: 'Phone',
      leadStatus: LEAD_STATUS.NEW,
      assignedAgent: owner._id,
      currency: 'BDT',
    })
    const followUpDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()

    const result: any = await LeadService.manageLead(organizationId, String(managedLead._id), {
      leadStatus: LEAD_STATUS.INTERESTED,
      assignedAgent: String(agent._id),
      followUpDate,
      reason: 'Phase 5 regression management update',
    }, String(owner._id), managerAccess())

    expect(result.leadStatus).toBe(LEAD_STATUS.INTERESTED)
    expect(String(result.assignedAgent?._id || result.assignedAgent)).toBe(String(agent._id))
    expect(new Date(result.followUpDate).getTime()).toBe(new Date(followUpDate).getTime())
  })

  it('hydrates paginated CRM rows without invoking the compatibility fallback', async () => {
    await Promise.all(Array.from({ length: 4 }, (_, index) => Lead.create({
      organizationId,
      name: `Phase 5 Page Lead ${index}`,
      phone: `+88018${String(10000000 + index)}`,
      normalizedPhone: `+88018${String(10000000 + index)}`,
      source: 'Website',
      leadStatus: LEAD_STATUS.NEW,
      assignedAgent: agent._id,
      currency: 'BDT',
    })))

    const warningSpy = vi.spyOn(logger, 'warn')
    const page = await readLeadListPage({ match: { organizationId }, skip: 0, limit: 2, sortBy: 'updatedAt', sortOrder: 'desc' })
    expect(page.rows).toHaveLength(2)
    expect(page.total).toBeGreaterThanOrEqual(4)
    expect(warningSpy.mock.calls.some((call) => call[0] === 'crm_lead_read_model_failed')).toBe(false)
  })

  it('creates a Website Submission that opens the existing Lead instead of creating a duplicate Lead', async () => {
    const linkedLead = await Lead.create({
      organizationId,
      name: 'Phase 5 Website Lead',
      phone: '+8801799999999',
      normalizedPhone: '+8801799999999',
      source: 'Website',
      leadStatus: LEAD_STATUS.NEW,
      assignedAgent: agent._id,
      currency: 'BDT',
    })
    const before = await Lead.countDocuments({ organizationId })
    const submission = await WebsiteSubmissionService.captureLead({
      organizationId,
      submissionContext: 'PROPERTY_ENQUIRY',
      name: linkedLead.name,
      phone: linkedLead.phone,
      email: linkedLead.email,
      propertyInterest: String(property._id),
      message: 'Phase 5 property enquiry',
      privacyConsent: true,
      policyVersion: 'phase5-regression',
      attribution: { landingPage: `/properties/${property.slug}` },
    }, linkedLead)
    const after = await Lead.countDocuments({ organizationId })
    expect(after).toBe(before)

    const enriched: any = await WebsiteSubmissionService.getById(organizationId, String(submission._id), { includeLeadDetails: true, crmAccess: managerAccess() })
    expect(String(enriched.linkedEntityId)).toBe(String(linkedLead._id))
    expect(enriched.linkedRecord).toMatchObject({ type: 'Lead', id: String(linkedLead._id), available: true })
    expect(enriched.linkedRecord.lead._id).toBe(String(linkedLead._id))
  })

  it('allows a successful void quota transaction and serializes two concurrent attempts for the final team seat', async () => {
    const reserve = async (suffix: string) => EntitlementService.withTeamMemberQuotaGuard(organizationId, async (session: any) => {
      await EntitlementService.assertTeamMemberCapacity(organizationId, { additionalCommitments: 1, session })
      await TeamInvitation.create([{
        organizationId,
        email: `phase5-pending-${suffix}-${runId}@example.test`,
        name: `Pending ${suffix}`,
        phoneNumber: `+88019${suffix.padStart(8, '0').slice(-8)}`,
        userRole: 'agent',
        tokenHash: `phase5-${suffix}-${runId}`,
        invitedBy: owner._id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      }], session ? { session } : undefined)
      // Intentionally return void. Phase 1's bug incorrectly interpreted this as transaction failure.
    })

    const results = await Promise.allSettled([reserve('10000001'), reserve('10000002')])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const fulfilled = results.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<unknown>
    expect(fulfilled.value).toBeUndefined()

    const quota = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId)
    expect(quota.teamMembersCommitted).toBe(quota.maxTeamMembers)
  })

  it('keeps bearer authentication valid while an expired subscription is rejected as 402 rather than a server error', async () => {
    const expiredUser = await User.create({
      name: 'Phase 5 Expired Owner',
      email: `phase5-expired-owner-${runId}@example.test`,
      phoneNumber: '+8801710101010',
      organizationId: expiredOrganizationId,
      userRole: 'agency_owner',
      status: 'active',
      isVerified: true,
    })
    await Organization.updateOne({ organizationId: expiredOrganizationId }, { $set: { ownerId: expiredUser._id } })
    const token = jwtHelpers.createToken({
      _id: String(expiredUser._id),
      phoneNumber: expiredUser.phoneNumber,
      email: expiredUser.email,
      userRole: expiredUser.userRole,
      organizationId: expiredOrganizationId,
    }, config.jwt.secret, config.jwt.expires_in)

    const session = await request('/api/v1/auth/session', token)
    expect(session.response.status).toBe(200)
    expect(session.body?.data?.authenticated).toBe(true)

    const notifications = await request('/api/v1/notification?limit=1', token)
    expect(notifications.response.status).toBe(402)
    expect(notifications.body?.code).toBe('SUBSCRIPTION_INACTIVE')
  })
})
