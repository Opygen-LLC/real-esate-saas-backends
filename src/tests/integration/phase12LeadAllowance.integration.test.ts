import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip
let mongoose: typeof import('mongoose')
let Organization: any
let SubscriptionBenefitPeriod: any
let LeadAllowanceReservation: any
let EntitlementService: any
const organizationId = 'org_phase12_lead_allowance'

suite('Phase 12 lead allowance concurrency', () => {
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
    ;({ SubscriptionBenefitPeriod } = await import('../../app/module/subscriptionBenefitPeriod/subscriptionBenefitPeriod.model'))
    ;({ LeadAllowanceReservation } = await import('../../app/module/entitlement/leadAllowanceReservation.model'))
    ;({ EntitlementService } = await import('../../app/module/entitlement/entitlement.service'))

    await Organization.create({
      organizationId,
      agencyName: 'Phase 12 Realty',
      email: 'phase12@example.test',
      phone: '+8801712000000',
      sub_domain: 'phase12-realty',
      subscription: {
        plan: 'starter',
        planVersion: 1,
        status: 'active',
        maxProperties: 100,
        maxAgents: 3,
        currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      },
    })
  }, 20_000)

  beforeEach(async () => {
    await SubscriptionBenefitPeriod.deleteMany({ organizationId })
    await LeadAllowanceReservation.deleteMany({ organizationId })
    await SubscriptionBenefitPeriod.create({
      organizationId,
      paymentSource: 'manual_payment',
      paymentNumber: `PAY-P12-${Date.now()}-${Math.random()}`,
      planId: 'starter',
      planVersion: 1,
      billingCycle: 'monthly',
      periodStart: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      periodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      renewalStreak: 2,
      baseLeadAllowance: 200,
      bonusLeadAllowance: 50,
      totalLeadAllowance: 250,
      usedLeadAllowance: 247,
      renewalBonusEnabled: true,
      renewalLeadBonus: 50,
      maxRenewalLeadBonus: 500,
      continuityGraceDays: 3,
    })
  })

  afterAll(async () => {
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('grants exactly three of ten concurrent single-lead reservations at 247/250', async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () =>
      EntitlementService.reserveLeadAllowance(organizationId, 1, { source: 'api' }),
    ))
    const fulfilled = results.filter((result) => result.status === 'fulfilled') as PromiseFulfilledResult<any>[]
    const rejected = results.filter((result) => result.status === 'rejected') as PromiseRejectedResult[]
    expect(fulfilled).toHaveLength(3)
    expect(rejected).toHaveLength(7)
    expect(rejected.every((result) => result.reason?.code === 'LEAD_ALLOWANCE_EXHAUSTED')).toBe(true)

    const period = await SubscriptionBenefitPeriod.findOne({ organizationId }).lean()
    expect(period.usedLeadAllowance).toBe(250)
  })

  it('returns a partial batch reservation instead of overshooting the period', async () => {
    const reservation = await EntitlementService.reserveLeadAllowance(organizationId, 10, { allowPartial: true, source: 'bulk_import' })
    expect(reservation).toMatchObject({ requestedUnits: 10, grantedUnits: 3, usedUnits: 247, limitUnits: 250 })
    const period = await SubscriptionBenefitPeriod.findOne({ organizationId }).lean()
    expect(period.usedLeadAllowance).toBe(250)

    await EntitlementService.releaseLeadAllowanceReservation(organizationId, reservation.reservationId)
    const releasedPeriod = await SubscriptionBenefitPeriod.findOne({ organizationId }).lean()
    expect(releasedPeriod.usedLeadAllowance).toBe(247)
  })
})
