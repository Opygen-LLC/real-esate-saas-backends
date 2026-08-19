import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip
let mongoose: typeof import('mongoose')
let Organization: any
let User: any
let TeamInvitation: any
let EntitlementService: any
let owner: any
const organizationId = 'org_phase2_team_quota'

const clearTenantMembers = async () => {
  await TeamInvitation.deleteMany({ organizationId })
  await User.deleteMany({ organizationId, _id: { $ne: owner._id } })
}

const addMember = async (role: 'agency_admin' | 'agent' | 'staff' | 'viewer', suffix: string) => User.create({
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
    ;({ EntitlementService } = await import('../../app/module/entitlement/entitlement.service'))

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
  }, 20_000)

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

  it('preserves existing users after a downgrade and reports over-capacity instead of deleting them', async () => {
    await clearTenantMembers()
    await addMember('agent', '40000001')
    await addMember('agency_admin', '40000002')
    await addMember('staff', '40000003')
    const quota = await EntitlementService.getTeamMemberQuotaSnapshot(organizationId)
    expect(quota).toMatchObject({ maxTeamMembers: 2, teamMembersUsed: 4, teamMembersAvailable: 0, teamMembersOverCapacityBy: 2 })
    expect(await User.countDocuments({ organizationId, status: { $ne: 'blocked' } })).toBe(4)
    await expect(EntitlementService.assertTeamMemberCapacity(organizationId, { additionalCommitments: 1 })).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' })
    expect(await User.countDocuments({ organizationId, status: { $ne: 'blocked' } })).toBe(4)
  })
})
