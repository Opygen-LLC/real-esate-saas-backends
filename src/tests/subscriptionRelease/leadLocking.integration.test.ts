import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip
let mongoose: typeof import('mongoose')
let Organization: any
let SubscriptionPlan: any
let SubscriptionBenefitPeriod: any
let LeadAllowanceReservation: any
let Lead: any
let EntitlementService: any
let LeadEntitlementService: any
let mongoSupportsTransactions: any
const organizationId = 'org_subscription_release_capacity'
const otherOrganizationId = 'org_subscription_release_other'

const starterV6 = {
  planId: 'starter', version: 6, name: 'Starter', priceMonthly: 500, priceYearly: 5000, currency: 'BDT',
  description: 'release test', features: [], maxAgents: 3, maxProperties: 10, maxLeads: 200,
  leadAllowanceModel: 'active_capacity', baseMonthlyLeadAllowance: 200, renewalLeadBonus: 50,
  renewalBonusEnabled: true, maxRenewalLeadBonus: 0, continuityGraceDays: 3,
  hasCustomDomain: false, hasAdvancedAnalytics: false, hasWhatsAppIntegration: false,
  hasLeadAutomations: false, hasSmsAutomation: false, hasPremiumTemplates: false,
  maxStorageMb: 1024, maxMonthlyVisitors: 10000, isPopular: false, isActive: true, isCurrent: true,
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null, grandfatherExisting: true,
}

const leadRows = (orgId: string, count: number, offset = 0) => {
  const base = new Date('2026-01-01T00:00:00.000Z').getTime()
  return Array.from({ length: count }, (_, index) => {
    const serial = offset + index + 1
    const phone = `+88018${String(serial).padStart(8, '0')}`
    return {
      organizationId: orgId,
      name: `Capacity Lead ${serial}`,
      phone,
      normalizedPhone: phone,
      email: `capacity-${orgId}-${serial}@example.test`,
      normalizedEmail: `capacity-${orgId}-${serial}@example.test`,
      leadStatus: 'New',
      isLocked: false,
      createdAt: new Date(base + serial * 1000),
      updatedAt: new Date(base + serial * 1000),
    }
  })
}

suite('active Lead capacity concurrency and rollback', () => {
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
    ;({ Organization } = await import('../../app/module/organization/organization.model'))
    ;({ SubscriptionPlan } = await import('../../app/module/subscriptionPlan/subscriptionPlan.model'))
    ;({ SubscriptionBenefitPeriod } = await import('../../app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.model'))
    ;({ LeadAllowanceReservation } = await import('../../app/module/entitlement/leadAllowanceReservation.model'))
    ;({ Lead } = await import('../../app/module/lead/lead.model'))
    ;({ EntitlementService } = await import('../../app/module/entitlement/entitlement.service'))
    ;({ LeadEntitlementService } = await import('../../app/module/lead/leadEntitlement.service'))
    ;({ mongoSupportsTransactions } = await import('../../app/db/mongoCapabilities'))
  }, 20_000)

  beforeEach(async () => {
    await mongoose.connection.dropDatabase()
    await SubscriptionPlan.create(starterV6)
    await Organization.create([
      {
        organizationId, agencyName: 'Capacity Realty', email: 'capacity@example.test', phone: '+8801711111111', sub_domain: 'capacity-realty',
        subscription: { plan: 'starter', planVersion: 6, status: 'active', maxProperties: 10, maxAgents: 3, currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000), source: 'manual_payment' },
      },
      {
        organizationId: otherOrganizationId, agencyName: 'Other Realty', email: 'other@example.test', phone: '+8801722222222', sub_domain: 'other-realty',
        subscription: { plan: 'starter', planVersion: 6, status: 'active', maxProperties: 10, maxAgents: 3, currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000), source: 'manual_payment' },
      },
    ])
    const now = Date.now()
    await SubscriptionBenefitPeriod.create([
      {
        organizationId, paymentSource: 'manual_payment', paymentNumber: 'REL-CAP-1', planId: 'starter', planVersion: 6, billingCycle: 'monthly',
        periodStart: new Date(now - 10 * 24 * 60 * 60 * 1000), periodEnd: new Date(now + 20 * 24 * 60 * 60 * 1000),
        renewalStreak: 1, baseLeadAllowance: 200, bonusLeadAllowance: 0, totalLeadAllowance: 200, usedLeadAllowance: 0,
        leadAllowanceModel: 'active_capacity', renewalBonusEnabled: true, renewalLeadBonus: 50, maxRenewalLeadBonus: 0, continuityGraceDays: 3,
      },
      {
        organizationId: otherOrganizationId, paymentSource: 'manual_payment', paymentNumber: 'REL-CAP-2', planId: 'starter', planVersion: 6, billingCycle: 'monthly',
        periodStart: new Date(now - 10 * 24 * 60 * 60 * 1000), periodEnd: new Date(now + 20 * 24 * 60 * 60 * 1000),
        renewalStreak: 1, baseLeadAllowance: 200, bonusLeadAllowance: 0, totalLeadAllowance: 200, usedLeadAllowance: 0,
        leadAllowanceModel: 'active_capacity', renewalBonusEnabled: true, renewalLeadBonus: 50, maxRenewalLeadBonus: 0, continuityGraceDays: 3,
      },
    ])
  }, 20_000)

  afterAll(async () => {
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('allows only one of two simultaneous creates to claim the final 200th accessible slot', async () => {
    await Lead.insertMany(leadRows(organizationId, 199))

    const createWithReservation = async (serial: number) => {
      const reservation = await EntitlementService.reserveLeadAllowance(organizationId, 1, { source: 'api' })
      if (!reservation.reservationId) throw new Error('reservation unexpectedly missing')
      const row = leadRows(organizationId, 1, serial)[0]
      try {
        const lead = await Lead.create(row)
        await EntitlementService.consumeLeadAllowanceReservation(organizationId, reservation.reservationId, 1)
        return lead
      } catch (error) {
        await EntitlementService.releaseLeadAllowanceReservation(organizationId, reservation.reservationId).catch(() => undefined)
        throw error
      }
    }

    const results = await Promise.allSettled([createWithReservation(1000), createWithReservation(2000)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await Lead.countDocuments({ organizationId })).toBe(200)
    expect(await LeadAllowanceReservation.countDocuments({ organizationId, status: 'reserved' })).toBe(0)
  }, 30_000)

  it('rolls back all lock mutations when the surrounding transaction fails', async () => {
    expect(await mongoSupportsTransactions(), 'Subscription release integration DB must be a replica set/mongos to validate rollback safety').toBe(true)
    await Lead.insertMany(leadRows(organizationId, 220))
    const session = await mongoose.startSession()
    try {
      await expect(session.withTransaction(async () => {
        const result = await LeadEntitlementService.reconcileLeadCapacity(organizationId, 200, session, 'system:test-rollback')
        expect(result.subscriptionLockedCount).toBe(20)
        throw new Error('force-release-test-rollback')
      })).rejects.toThrow('force-release-test-rollback')
    } finally {
      await session.endSession()
    }
    expect(await Lead.countDocuments({ organizationId })).toBe(220)
    expect(await Lead.countDocuments({ organizationId, isLocked: true, lockReason: 'subscription_limit' })).toBe(0)
  }, 30_000)

  it('never changes another tenant while reconciling a capacity downgrade', async () => {
    await Lead.insertMany([...leadRows(organizationId, 220), ...leadRows(otherOrganizationId, 10, 5000)])
    await LeadEntitlementService.reconcileLeadCapacity(organizationId, 200, undefined, 'system:test-tenant-isolation')
    expect(await Lead.countDocuments({ organizationId, isLocked: true, lockReason: 'subscription_limit' })).toBe(20)
    expect(await Lead.countDocuments({ organizationId: otherOrganizationId, isLocked: true })).toBe(0)
    expect(await Lead.countDocuments({ organizationId: otherOrganizationId })).toBe(10)
  })
})
