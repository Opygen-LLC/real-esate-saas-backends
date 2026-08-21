import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const requiredDb = process.env.TEST_DATABASE_URL
const suite = requiredDb ? describe : describe.skip
let mongoose: typeof import('mongoose')
let Organization: any
let SubscriptionPlan: any
let Lead: any
let AuditEvent: any
let SubscriptionScheduleService: any
let reconcileOrganizationEntitlements: any
const organizationId = 'org_subscription_release_downgrade'

const planDoc = (planId: 'starter' | 'professional', version: number, maxLeads: number, maxAgents: number, maxProperties: number, maxStorageMb: number) => ({
  planId,
  version,
  name: planId === 'starter' ? 'Starter' : 'Professional',
  priceMonthly: planId === 'starter' ? 500 : 1000,
  priceYearly: planId === 'starter' ? 5000 : 10000,
  currency: 'BDT',
  description: 'release test',
  features: [],
  maxAgents,
  maxProperties,
  maxLeads,
  leadAllowanceModel: 'active_capacity',
  baseMonthlyLeadAllowance: maxLeads,
  renewalLeadBonus: planId === 'starter' ? 50 : 100,
  renewalBonusEnabled: true,
  maxRenewalLeadBonus: 0,
  continuityGraceDays: 3,
  hasCustomDomain: planId === 'professional',
  hasAdvancedAnalytics: planId === 'professional',
  hasWhatsAppIntegration: planId === 'professional',
  hasLeadAutomations: planId === 'professional',
  hasSmsAutomation: planId === 'professional',
  hasPremiumTemplates: planId === 'professional',
  maxStorageMb,
  maxMonthlyVisitors: 10000,
  isPopular: false,
  isActive: true,
  isCurrent: true,
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveTo: null,
  grandfatherExisting: true,
})

const seedLeads = async (count: number) => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z').getTime()
  await Lead.insertMany(Array.from({ length: count }, (_, index) => ({
    organizationId,
    name: `Lead ${String(index + 1).padStart(3, '0')}`,
    phone: `+88017${String(index + 1).padStart(8, '0')}`,
    normalizedPhone: `+88017${String(index + 1).padStart(8, '0')}`,
    email: `lead-${index + 1}@example.test`,
    normalizedEmail: `lead-${index + 1}@example.test`,
    leadStatus: 'New',
    createdAt: new Date(createdAt + index * 1000),
    updatedAt: new Date(createdAt + index * 1000),
  })), { ordered: true })
}

suite('subscription deferred downgrade production release', () => {
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
    ;({ Lead } = await import('../../app/module/lead/lead.model'))
    ;({ AuditEvent } = await import('../../app/module/audit/audit.model'))
    ;({ SubscriptionScheduleService } = await import('../../app/module/subscription/subscriptionSchedule.service'))
    ;({ reconcileOrganizationEntitlements } = await import('../../app/module/entitlement/subscriptionEntitlementReconciliation.service'))
  }, 20_000)

  beforeEach(async () => {
    await mongoose.connection.dropDatabase()
    await SubscriptionPlan.create([
      planDoc('starter', 6, 200, 3, 10, 1024),
      planDoc('professional', 4, 800, 5, 25, 1024),
    ])
    await Organization.create({
      organizationId,
      agencyName: 'Release Downgrade Realty',
      email: 'release-downgrade@example.test',
      phone: '+8801712345678',
      sub_domain: 'release-downgrade',
      subscription: {
        plan: 'professional',
        planVersion: 4,
        revision: 0,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 60 * 60 * 1000),
        maxProperties: 25,
        maxAgents: 5,
        source: 'manual_payment',
      },
    })
    await seedLeads(620)
  }, 30_000)

  afterAll(async () => {
    if (mongoose?.connection?.readyState) await mongoose.connection.dropDatabase().catch(() => undefined)
    await mongoose?.disconnect().catch(() => undefined)
  })

  it('keeps Professional active until the exact boundary, then applies Starter v6 exactly once and locks only overflow', async () => {
    const before: any = await Organization.findOne({ organizationId })
    const effectiveAt = new Date(before.subscription.currentPeriodEnd)
    await SubscriptionScheduleService.scheduleDowngradeOnOrganization(before, {
      planId: 'starter',
      planVersion: 6,
      billingCycle: 'monthly',
      effectiveAt,
      source: 'manual_payment',
    })

    let current: any = await Organization.findOne({ organizationId }).lean()
    expect(current.subscription.plan).toBe('professional')
    expect(current.subscription.planVersion).toBe(4)
    expect(current.subscription.scheduledPlan).toBe('starter')
    expect(current.subscription.scheduledPlanVersion).toBe(6)
    expect(await Lead.countDocuments({ organizationId, isLocked: true })).toBe(0)

    const early = await SubscriptionScheduleService.applyDueChange(organizationId, { now: new Date(effectiveAt.getTime() - 1) })
    expect(early.applied).toBe(false)
    current = await Organization.findOne({ organizationId }).lean()
    expect(current.subscription.plan).toBe('professional')

    const attempts = await Promise.allSettled([
      SubscriptionScheduleService.applyDueChange(organizationId, { now: new Date(effectiveAt.getTime() + 1), actorId: 'worker:a' }),
      SubscriptionScheduleService.applyDueChange(organizationId, { now: new Date(effectiveAt.getTime() + 1), actorId: 'worker:b' }),
    ])
    const applied = attempts
      .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
      .filter((result) => result.value?.applied === true)
    expect(applied).toHaveLength(1)

    current = await Organization.findOne({ organizationId }).lean()
    expect(current.subscription.plan).toBe('starter')
    expect(current.subscription.planVersion).toBe(6)
    expect(current.subscription.scheduledPlan).toBeNull()
    expect(await Lead.countDocuments({ organizationId })).toBe(620)
    expect(await Lead.countDocuments({ organizationId, isLocked: { $ne: true } })).toBe(200)
    expect(await Lead.countDocuments({ organizationId, isLocked: true, lockReason: 'subscription_limit' })).toBe(420)
    expect(await AuditEvent.countDocuments({ organizationId, action: 'subscription.scheduled_change_applied' })).toBe(1)

    const newest = await Lead.find({ organizationId }).sort({ createdAt: -1, _id: -1 }).limit(200).select('_id isLocked').lean()
    expect(newest).toHaveLength(200)
    expect(newest.every((lead: any) => lead.isLocked !== true)).toBe(true)
  }, 45_000)

  it('unlocks all preserved Leads when the tenant upgrades back to Professional capacity', async () => {
    const starter = await SubscriptionPlan.findOne({ planId: 'starter', version: 6 }).lean()
    const professional = await SubscriptionPlan.findOne({ planId: 'professional', version: 4 }).lean()
    await reconcileOrganizationEntitlements(organizationId, professional, starter, { actorId: 'system:test-downgrade' })
    expect(await Lead.countDocuments({ organizationId, isLocked: true, lockReason: 'subscription_limit' })).toBe(420)

    await Organization.updateOne({ organizationId }, {
      $set: {
        'subscription.plan': 'professional',
        'subscription.planVersion': 4,
        'subscription.maxProperties': 25,
        'subscription.maxAgents': 5,
      },
    })
    await reconcileOrganizationEntitlements(organizationId, starter, professional, { actorId: 'system:test-upgrade' })
    expect(await Lead.countDocuments({ organizationId })).toBe(620)
    expect(await Lead.countDocuments({ organizationId, isLocked: true, lockReason: 'subscription_limit' })).toBe(0)
  }, 30_000)
})
