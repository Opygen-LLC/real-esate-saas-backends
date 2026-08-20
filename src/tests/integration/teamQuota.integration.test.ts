import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip
let mongoose: typeof import('mongoose')
let Organization: any
let User: any
let TeamInvitation: any
let AuthSession: any
let AuditEvent: any
let EntitlementService: any
let reconcileTeamSeats: any
let reconcileOrganizationEntitlements: any
let UserService: any
let owner: any
const organizationId = 'org_phase2_team_quota'

const clearTenantMembers = async () => {
  await TeamInvitation.deleteMany({ organizationId })
  await AuthSession.deleteMany({ organizationId })
  await AuditEvent.collection.deleteMany({ organizationId })
  await User.deleteMany({ organizationId, _id: { $ne: owner._id } })
}

const addMember = async (role: 'agency_owner' | 'agency_admin' | 'agent' | 'staff' | 'viewer', suffix: string) => User.create({
  name: `${role} ${suffix}`,
  email: `${role}-${suffix}@example.test`,
  phoneNumber: `+88018${suffix.padStart(8, '0').slice(-8)}`,
  organizationId,
  userRole: role,
  status: 'active',
  isVerified: true,
})

const reservePendingSeat = async (suffix: string) => EntitlementService.withTeamMemberQuotaGuard(
  organizationId,
  async (session: any) => {
    await EntitlementService.assertTeamMemberCapacity(organizationId, { additionalCommitments: 1, session })
    const options = session ? { session } : undefined
    await TeamInvitation.create([{
      organizationId,
      email: `pending-${suffix}@example.test`,
      name: `Pending ${suffix}`,
      phoneNumber: `+88019${suffix.padStart(8, '0').slice(-8)}`,
      userRole: 'agent',
      tokenHash: `phase2-${suffix}-${Date.now()}-${Math.random()}`,
      invitedBy: owner._id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    }], options)
  },
)

suite('phase 2 tenant-wide team quota', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = requiredDb!
    process.env.REDIS_ENABLED = 'false'
    process.env.WORKER_ENABLED = 'false'
    process.env.CLIENT_URL = 'http://localhost:3000'
    process.env.PUBLIC_API_URL = 'http://127.0.0.1:5000'
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000'

    mongoose = await import('mongoose')
    await mongoose.connect(requiredDb!, { autoIndex: true, serverSelectionTimeoutMS: 5000 })
    await mongoose.connection.dropDatabase()
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ User } = await import('../../app/module/user/user.model'))
    ;({ TeamInvitation } = await import('../../app/module/teamInvitation/teamInvitation.model'))
    ;({ AuthSession } = await import('../../app/module/auth/authSession.model'))
    ;({ AuditEvent } = await import('../../app/module/audit/audit.model'))
    ;({ EntitlementService } = await import('../../app/module/entitlement/entitlement.service'))
    ;({ reconcileTeamSeats } = await import('../../app/module/entitlement/teamSeatReconciliation.service'))
    ;({ reconcileOrganizationEntitlements } = await import('../../app/module/entitlement/subscriptionEntitlementReconciliation.service'))
    ;({ UserService } = await import('../../app/module/user/user.service'))

    await Organization.create({
      organizationId,
      agencyName: 'Phase 2 Team Quota Realty',
      email: 'quota@example.test',
      phone: '+8801711111111',
      sub_domain: 'phase2-team-quota',
      subscription: { plan: 'trial', status: 'trialing', maxProperties: 10, maxAgents: 2 },
    })
    owner = await User.create({
      name: 'Quota Owner',
      email: 'quota-owner@example.test',
      phoneNumber: '+8801722222222',
      organizationId,
      userRole: 'agency_owner',
      status: 'active',
      isVerified: true,
    })
    await Organization.updateOne({ organizationId }, { $set: { ownerId: owner._id } })
  }, 20_000)

  beforeEach(async () => {
    await Organization.updateOne({ organizationId }, { $set: { 'subscription.maxAgents': 2 } })
    await User.updateOne({ _id: owner._id }, { $set: { status: 'active' }, $unset: { accessRestriction: '' } })
  })

  afterAll(async () => {
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it.each(['agent', 'agency_admin', 'staff', 'viewer'] as const)('owner + %s consumes the same two-seat plan', async (role) => {
    await clearTenantMembers()
    await addMember(role, role === 'agent' ? '10000001' : role === 'agency_admin' ? '10000002' : role === 'staff' ? '10000003' : '10000004')
    const quota = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId)
    expect(quota).toMatchObject({ maxTeamMembers: 2, teamMembersUsed: 2, teamMembersReserved: 0, teamMembersAvailable: 0 })
    await expect(EntitlementService.assertTeamMemberCapacity(organizationId, { additionalCommitments: 1 })).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' })
  })

  it('counts a pending invitation as a reserved seat', async () => {
    await clearTenantMembers()
    await reservePendingSeat('20000001')
    const quota = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId)
    expect(quota).toMatchObject({ maxTeamMembers: 2, teamMembersUsed: 1, teamMembersReserved: 1, teamMembersCommitted: 2, teamMembersAvailable: 0 })
  })

  it('serializes two simultaneous reservations so only one can take the final seat', async () => {
    await clearTenantMembers()
    const results = await Promise.allSettled([reservePendingSeat('30000001'), reservePendingSeat('30000002')])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const quota = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId)
    expect(quota).toMatchObject({ teamMembersUsed: 1, teamMembersReserved: 1, teamMembersCommitted: 2, teamMembersAvailable: 0 })
  })

  it('downgrades to a three-seat plan as owner + two members and quota-blocks overflow without deleting accounts', async () => {
    await clearTenantMembers()
    await addMember('agent', '40000001')
    await addMember('agency_admin', '40000002')
    await addMember('staff', '40000003')
    await addMember('viewer', '40000004')
    await Organization.updateOne({ organizationId }, { $set: { 'subscription.maxAgents': 3 } })

    expect(await User.countDocuments({ organizationId })).toBe(5)
    const reconciliation = await reconcileOrganizationEntitlements(
      organizationId,
      { plan: 'professional', planVersion: 1, maxAgents: 5 },
      { plan: 'starter', planVersion: 1, maxAgents: 3 },
      { actorId: 'system:test', reason: 'Integration-test downgrade' },
    )

    expect(reconciliation.direction).toBe('downgrade')
    expect(reconciliation.teamSeats.blockedUserIds).toHaveLength(2)
    expect(await User.countDocuments({ organizationId })).toBe(5)
    expect(await User.countDocuments({ organizationId, userRole: 'agency_owner', status: 'active' })).toBe(1)
    expect(await User.countDocuments({ organizationId, status: { $ne: 'blocked' } })).toBe(3)
    expect(await User.countDocuments({ organizationId, status: 'blocked', 'accessRestriction.source': 'subscription_quota' })).toBe(2)

    const audit = await AuditEvent.findOne({ organizationId, action: 'subscription.team_seats_reconciled' }).lean()
    expect(audit?.metadata?.protectedOwnerUserId).toBe(String(owner._id))
    expect(audit?.metadata?.selectionPolicy).toBe('canonical_owner>agency_admin>agent>staff>viewer>oldest_membership>id')
    expect(audit?.metadata?.blockedUserIds).toHaveLength(2)

    const quota = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId)
    expect(quota).toMatchObject({ maxTeamMembers: 3, teamMembersUsed: 3, teamMembersReserved: 0, teamMembersAvailable: 0, teamMembersOverCapacityBy: 0 })
  })

  it('returns TEAM_SEAT_LIMIT_REACHED on unblock when full, then permits a one-for-one seat swap', async () => {
    await clearTenantMembers()
    const activeMember = await addMember('agent', '50000001')
    const overflowMember = await addMember('staff', '50000002')
    await reconcileTeamSeats(organizationId, 2, { previousMaxTeamMembers: 3, actorId: 'system:test' })

    const blocked = await User.findById(overflowMember._id).lean()
    expect(blocked?.status).toBe('blocked')
    expect(blocked?.accessRestriction?.source).toBe('subscription_quota')

    await expect(UserService.updateMemberSeatAccess(organizationId, owner._id.toString(), overflowMember._id.toString(), true))
      .rejects.toMatchObject({ statusCode: 409, code: 'TEAM_SEAT_LIMIT_REACHED' })

    await UserService.updateMemberSeatAccess(organizationId, owner._id.toString(), activeMember._id.toString(), false)
    let quota = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId)
    expect(quota).toMatchObject({ teamMembersUsed: 1, teamMembersAvailable: 1 })

    await UserService.updateMemberSeatAccess(organizationId, owner._id.toString(), overflowMember._id.toString(), true)
    quota = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId)
    expect(quota).toMatchObject({ teamMembersUsed: 2, teamMembersAvailable: 0 })
    expect((await User.findById(activeMember._id).lean())?.accessRestriction?.source).toBe('tenant_admin')
    expect((await User.findById(overflowMember._id).lean())?.status).toBe('active')
  })

  it('keeps the agency-owner seat reserved even while the platform has blocked the owner', async () => {
    await clearTenantMembers()
    await User.updateOne({ _id: owner._id }, { $set: { status: 'blocked', accessRestriction: { source: 'platform_admin', reason: 'test', blockedAt: new Date(), blockedBy: 'test', previousStatus: 'active' } } })
    const quota = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId)
    expect(quota).toMatchObject({ maxTeamMembers: 2, teamMembersUsed: 1, teamMembersAvailable: 1 })
    await User.updateOne({ _id: owner._id }, { $set: { status: 'active' }, $unset: { accessRestriction: '' } })
  })

  it('keeps members deterministically by role priority and then oldest membership', async () => {
    await clearTenantMembers()
    const newerAdmin = await addMember('agency_admin', '61000001')
    const olderAgent = await addMember('agent', '61000002')
    const newerAgent = await addMember('agent', '61000003')
    const oldestStaff = await addMember('staff', '61000004')

    await User.updateOne({ _id: newerAdmin._id }, { $set: { createdAt: new Date('2025-04-01T00:00:00.000Z') } })
    await User.updateOne({ _id: olderAgent._id }, { $set: { createdAt: new Date('2025-01-01T00:00:00.000Z') } })
    await User.updateOne({ _id: newerAgent._id }, { $set: { createdAt: new Date('2025-02-01T00:00:00.000Z') } })
    await User.updateOne({ _id: oldestStaff._id }, { $set: { createdAt: new Date('2024-01-01T00:00:00.000Z') } })

    await reconcileTeamSeats(organizationId, 3, { previousMaxTeamMembers: 5, actorId: 'system:test' })

    expect((await User.findById(newerAdmin._id).lean())?.status).toBe('active')
    expect((await User.findById(olderAgent._id).lean())?.status).toBe('active')
    expect((await User.findById(newerAgent._id).lean())?.accessRestriction?.source).toBe('subscription_quota')
    expect((await User.findById(oldestStaff._id).lean())?.accessRestriction?.source).toBe('subscription_quota')
  })

  it('protects only the canonical organization owner when legacy duplicate owner-role users exist', async () => {
    await clearTenantMembers()
    const duplicateOwner = await addMember('agency_owner', '62000001')

    const reconciliation = await reconcileTeamSeats(organizationId, 1, { previousMaxTeamMembers: 2, actorId: 'system:test' })

    expect(reconciliation.protectedOwnerUserId).toBe(String(owner._id))
    expect((await User.findById(owner._id).lean())?.status).toBe('active')
    expect((await User.findById(duplicateOwner._id).lean())?.status).toBe('blocked')
    expect((await User.findById(duplicateOwner._id).lean())?.accessRestriction?.source).toBe('subscription_quota')
    const quota = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId)
    expect(quota).toMatchObject({ maxTeamMembers: 2, teamMembersUsed: 1 })
  })

  it('never auto-reactivates a legacy blocked user with unknown restriction provenance', async () => {
    await clearTenantMembers()
    const legacyBlocked = await addMember('agent', '63000001')
    await User.collection.updateOne({ _id: legacyBlocked._id }, { $set: { status: 'blocked' }, $unset: { accessRestriction: '' } })

    await reconcileTeamSeats(organizationId, 3, { previousMaxTeamMembers: 2, actorId: 'system:test' })

    const after = await User.findById(legacyBlocked._id).lean()
    expect(after?.status).toBe('blocked')
    expect(after?.accessRestriction).toBeFalsy()
  })

  it('revokes active sessions for users blocked by a downgrade', async () => {
    await clearTenantMembers()
    const admin = await addMember('agency_admin', '64000001')
    const overflow = await addMember('viewer', '64000002')
    await AuthSession.create({
      userId: overflow._id,
      organizationId,
      familyId: 'phase6-overflow-session',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      revokedAt: null,
      sessionVersion: 1,
      authorizationVersion: 1,
    })

    await reconcileTeamSeats(organizationId, 2, { previousMaxTeamMembers: 3, actorId: 'system:test' })

    expect((await User.findById(admin._id).lean())?.status).toBe('active')
    expect((await User.findById(overflow._id).lean())?.accessRestriction?.source).toBe('subscription_quota')
    const session = await AuthSession.findOne({ userId: overflow._id }).lean()
    expect(session?.revokedAt).toBeTruthy()
    expect(session?.revokeReason).toBe('subscription_quota')
  })

  it('allows an agency admin to manage normal seats but never the canonical owner seat', async () => {
    await clearTenantMembers()
    await Organization.updateOne({ organizationId }, { $set: { 'subscription.maxAgents': 3 } })
    const admin = await addMember('agency_admin', '65000001')
    const staff = await addMember('staff', '65000002')

    await expect(UserService.updateMemberSeatAccess(
      organizationId,
      admin._id.toString(),
      owner._id.toString(),
      false,
    )).rejects.toMatchObject({ statusCode: 403, code: 'OWNER_SEAT_PROTECTED' })

    await UserService.updateMemberSeatAccess(
      organizationId,
      admin._id.toString(),
      staff._id.toString(),
      false,
    )
    const blockedStaff = await User.findById(staff._id).lean()
    expect(blockedStaff?.status).toBe('blocked')
    expect(blockedStaff?.accessRestriction?.source).toBe('tenant_admin')
    expect(blockedStaff?.accessRestriction?.blockedBy).toBe(String(admin._id))
  })

  it('scopes seat-access writes to the actor tenant', async () => {
    await clearTenantMembers()
    const outsider = await User.create({
      name: 'Other Tenant Agent',
      email: 'other-tenant-agent@example.test',
      phoneNumber: '+8801865000003',
      organizationId: 'other_tenant',
      userRole: 'agent',
      status: 'active',
      isVerified: true,
    })

    await expect(UserService.updateMemberSeatAccess(
      organizationId,
      owner._id.toString(),
      outsider._id.toString(),
      false,
    )).rejects.toMatchObject({ statusCode: 404 })

    expect((await User.findById(outsider._id).lean())?.status).toBe('active')
    await User.deleteOne({ _id: outsider._id })
  })

  it('serializes simultaneous unblocks so only one request can claim the final seat', async () => {
    await clearTenantMembers()
    await Organization.updateOne({ organizationId }, { $set: { 'subscription.maxAgents': 3 } })
    const admin = await addMember('agency_admin', '66000001')
    const firstBlocked = await addMember('staff', '66000002')
    const secondBlocked = await addMember('viewer', '66000003')

    await User.updateMany(
      { _id: { $in: [firstBlocked._id, secondBlocked._id] } },
      {
        $set: {
          status: 'blocked',
          accessRestriction: {
            source: 'tenant_admin',
            reason: 'Concurrency fixture',
            blockedAt: new Date(),
            blockedBy: owner._id.toString(),
            previousStatus: 'active',
          },
        },
      },
    )

    const before = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId)
    expect(before).toMatchObject({
      maxTeamMembers: 3,
      teamMembersUsed: 2,
      teamMembersCommitted: 2,
      teamMembersAvailable: 1,
    })

    const attempts = await Promise.allSettled([
      UserService.updateMemberSeatAccess(organizationId, admin._id.toString(), firstBlocked._id.toString(), true),
      UserService.updateMemberSeatAccess(organizationId, admin._id.toString(), secondBlocked._id.toString(), true),
    ])

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.find((result) => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ statusCode: 409, code: 'TEAM_SEAT_LIMIT_REACHED' })

    const after = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId)
    expect(after).toMatchObject({
      maxTeamMembers: 3,
      teamMembersUsed: 3,
      teamMembersCommitted: 3,
      teamMembersAvailable: 0,
    })
    expect(await User.countDocuments({
      _id: { $in: [firstBlocked._id, secondBlocked._id] },
      status: 'active',
    })).toBe(1)
  })


})
